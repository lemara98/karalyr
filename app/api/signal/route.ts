import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { revisions, signals } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { fingerprintFromRequest } from "@/lib/fingerprint";
import { runPromotionChecks } from "@/lib/promotion";
import { computeBestRevision } from "@/lib/ranking";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { MAX_REPORT_NOTE_LENGTH, REPORT_REASON_VALUES } from "@/lib/reports";
import { getKvStore } from "@/lib/stores";

const bodySchema = z.object({
  revision_id: z.number().int().positive(),
  type: z.enum([
    "explicit_up",
    "explicit_down",
    "offset_correction",
    "clean_playthrough",
    "content_report",
  ]),
  // Offset in ms for offset_correction; clamped to +-60s.
  value: z.number().int().min(-60_000).max(60_000).nullish(),
  // content_report only: why the lyrics content is wrong, plus an optional note.
  reason: z.enum(REPORT_REASON_VALUES).nullish(),
  note: z.string().trim().max(MAX_REPORT_NOTE_LENGTH).nullish(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid body" : "Invalid JSON body";
    return apiError(400, "BadRequest", message);
  }

  if (body.type === "offset_correction" && body.value == null) {
    return apiError(400, "BadRequest", "offset_correction requires value (offset in ms)");
  }
  if (body.type === "content_report" && !body.reason) {
    return apiError(400, "BadRequest", "content_report requires reason");
  }

  const fingerprint = fingerprintFromRequest(req);
  const { allowed } = await checkRateLimit(
    getKvStore(),
    `signal:${fingerprint}`,
    RATE_LIMITS.signal.limit,
    RATE_LIMITS.signal.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Signal rate limit exceeded");

  const db = getDb();
  const [revision] = await db.select().from(revisions).where(eq(revisions.id, body.revision_id));
  if (!revision) return apiError(404, "RevisionNotFound", "Revision does not exist");
  if (revision.status !== "active") {
    return apiError(400, "BadRequest", "Signals can only target active revisions");
  }

  // One up/down/clean per fingerprint per revision; offset reports may repeat
  // (the latest value per fingerprint is what Rule B uses).
  if (body.type !== "offset_correction") {
    const [existing] = await db
      .select({ id: signals.id })
      .from(signals)
      .where(
        and(
          eq(signals.revisionId, body.revision_id),
          eq(signals.type, body.type),
          eq(signals.fingerprint, fingerprint)
        )
      )
      .limit(1);
    if (existing) {
      return apiError(409, "AlreadySignaled", "You already sent this signal for this revision");
    }
  }

  await db.insert(signals).values({
    revisionId: body.revision_id,
    type: body.type,
    value: body.type === "offset_correction" ? body.value : null,
    reason: body.type === "content_report" ? body.reason : null,
    note: body.type === "content_report" ? body.note || null : null,
    fingerprint,
    createdAt: Date.now(),
  });

  const promotion = await runPromotionChecks(db, body.revision_id);
  // Signals affect ranking even when nothing promoted.
  await computeBestRevision(db, revision.trackId);

  return json({
    ok: true,
    promoted: promotion.promoted,
    correction_revision_id: promotion.correctionRevisionId,
  });
}

export const OPTIONS = corsOptions;
