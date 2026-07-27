import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { fingerprintFromRequest } from "@/lib/fingerprint";
import { checkRateLimit } from "@/lib/rate-limit";
import { getKvStore } from "@/lib/stores";
import { recordNotice, TAKEDOWN_EMAIL } from "@/lib/takedown";

/**
 * Public intake for rights complaints.
 *
 * Deliberately unauthenticated and account-free: a rightsholder must be able
 * to complain in one step, without signing up for the service they are
 * complaining about. Rate-limited only to keep it from being a spam vector —
 * the limit is loose, because a notice being dropped is far worse than a
 * duplicate being stored.
 *
 * Nothing here removes anything. It records the notice; an admin actions it
 * (lib/takedown.ts), so a removal always has a person behind it.
 */
const bodySchema = z.object({
  claimant_name: z.string().min(1).max(200),
  claimant_email: z.string().email().max(320),
  claimant_org: z.string().max(200).nullish(),
  claimant_role: z.string().min(1).max(200),
  work_description: z.string().min(1).max(5000),
  complained_of: z.string().min(1).max(5000),
  track_id: z.number().int().positive().nullish(),
  // Not stored: asserting them is the point, and a stored `true` proves
  // nothing. Required so the claimant has to make the statement knowingly.
  good_faith: z.literal(true),
  accurate: z.literal(true),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message ?? "Invalid body"
        : "Invalid JSON body";
    return apiError(400, "BadRequest", message);
  }

  const { allowed } = await checkRateLimit(
    getKvStore(),
    `takedown:${fingerprintFromRequest(req)}`,
    10,
    60 * 60 * 1000
  );
  if (!allowed) {
    return apiError(
      429,
      "TooManyRequests",
      `Too many notices from this address in the last hour. Email ${TAKEDOWN_EMAIL} instead — that route is never rate limited.`
    );
  }

  const notice = await recordNotice(getDb(), {
    claimantName: body.claimant_name,
    claimantEmail: body.claimant_email,
    claimantOrg: body.claimant_org,
    claimantRole: body.claimant_role,
    workDescription: body.work_description,
    complainedOf: body.complained_of,
    trackId: body.track_id,
  });

  return json({ ok: true, notice_id: notice.id, received_at: notice.createdAt });
}

export const OPTIONS = corsOptions;
