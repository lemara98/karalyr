import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { SYNC_JOB_ACTIVE_STATUSES, syncJobVotes, syncJobs } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getKvStore } from "@/lib/stores";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({ job_id: z.number().int().positive() });

/**
 * "I want this too" on an existing request. Adding demand to something already
 * asked for costs nothing to fulfil, so this is separate from the intake
 * routes: no lyrics, no link, just a vote.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Invalid request body");
  }

  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(401, "Unauthorized", "Sign in to back a request");

  const { allowed } = await checkRateLimit(
    getKvStore(),
    `syncvote:${user.id}`,
    RATE_LIMITS.syncQueueVote.limit,
    RATE_LIMITS.syncQueueVote.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Too many votes; try again later");

  const db = getDb();
  const [job] = await db
    .select({ id: syncJobs.id })
    .from(syncJobs)
    .where(
      and(eq(syncJobs.id, body.job_id), inArray(syncJobs.status, SYNC_JOB_ACTIVE_STATUSES))
    )
    .limit(1);
  if (!job) return apiError(404, "NotFound", "That request is no longer open");

  try {
    await db.insert(syncJobVotes).values({ jobId: job.id, userId: user.id, createdAt: Date.now() });
  } catch (err) {
    // Already backed it — idempotent, not an error worth showing anyone.
    const dup = err instanceof Error && String(err.cause ?? err).includes("UNIQUE constraint failed");
    if (!dup) throw err;
  }

  return json({ ok: true });
}

export const OPTIONS = corsOptions;
