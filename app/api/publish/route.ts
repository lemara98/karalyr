import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { findOrCreateTrack, insertRevision } from "@/lib/db/queries";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { fingerprintFromRequest } from "@/lib/fingerprint";
import {
  FormatError,
  parseByFormat,
  validatePayload,
  type LyricsPayload,
} from "@/lib/formats";
import { verifyAndConsumeSolution } from "@/lib/pow";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getKvStore } from "@/lib/stores/memory";

const bodySchema = z.object({
  challenge: z.object({ prefix: z.string(), nonce: z.string() }),
  artist_name: z.string().min(1).max(500),
  track_name: z.string().min(1).max(500),
  album_name: z.string().max(500).nullish(),
  duration: z.number().positive().max(24 * 60 * 60),
  // Either a structured payload or raw text + format.
  payload: z.unknown().optional(),
  raw: z.string().max(500_000).optional(),
  format: z.enum(["lrc", "enhanced_lrc", "ultrastar"]).optional(),
  source: z.enum(["user_submission", "ultrastar_import", "correction"]).default("user_submission"),
  parent_revision_id: z.number().int().positive().nullish(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid body" : "Invalid JSON body";
    return apiError(400, "BadRequest", message);
  }

  const store = getKvStore();
  const fingerprint = fingerprintFromRequest(req);

  const { allowed } = await checkRateLimit(
    store,
    `publish:${fingerprint}`,
    RATE_LIMITS.publish.limit,
    RATE_LIMITS.publish.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Publish rate limit exceeded");

  const verdict = await verifyAndConsumeSolution(store, body.challenge.prefix, body.challenge.nonce);
  if (!verdict.ok) {
    return apiError(400, "IncorrectPublishToken", `Challenge verification failed: ${verdict.reason}`);
  }

  let payload: LyricsPayload;
  try {
    if (body.payload !== undefined) {
      payload = validatePayload(body.payload);
    } else if (body.raw !== undefined) {
      payload = parseByFormat(body.raw, body.format ?? "lrc");
    } else {
      return apiError(400, "BadRequest", "Provide either payload or raw + format");
    }
  } catch (err) {
    if (err instanceof FormatError) return apiError(400, "BadRequest", err.message);
    throw err;
  }
  if (payload.lines.length === 0) {
    return apiError(400, "BadRequest", "Lyrics payload has no lines");
  }

  const db = getDb();
  const track = await findOrCreateTrack(db, {
    artistName: body.artist_name,
    trackName: body.track_name,
    albumName: body.album_name ?? null,
    durationSeconds: body.duration,
  });

  const source = body.source === "user_submission" && body.parent_revision_id ? "correction" : body.source;
  const revision = await insertRevision(db, {
    trackId: track.id,
    source,
    tier: "community",
    payload,
    parentRevisionId: body.parent_revision_id ?? null,
    submitterFingerprint: fingerprint,
  });

  return json(
    {
      track_id: track.id,
      revision_id: revision.id,
      status: revision.status,
      tier: revision.tier,
      message:
        revision.status === "pending_review"
          ? "This track's current lyrics are verified; your submission is queued for review."
          : "Published.",
    },
    { status: 201 }
  );
}

export const OPTIONS = corsOptions;
