import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { insertSyncJobComment, listSyncJobComments } from "@/lib/db/queries";
import { syncJobs, type SyncJobComment } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { MAX_COMMENT_BODY_CHARS } from "@/lib/comments";
import { verifyAndConsumeSolution } from "@/lib/pow";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getKvStore } from "@/lib/stores";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

function commentDto(c: SyncJobComment) {
  return {
    id: c.id,
    job_id: c.jobId,
    body: c.body,
    author_name: c.authorName ?? "Anonymous",
    created_at: c.createdAt,
  };
}

/** Comments on a queue candidate. GET is public; POST needs an account. */
export async function GET(req: Request) {
  const jobId = parseInt(new URL(req.url).searchParams.get("job_id") ?? "", 10);
  if (!Number.isFinite(jobId)) {
    return apiError(400, "BadRequest", "job_id must be a number");
  }

  const db = getDb();
  const [job] = await db.select({ id: syncJobs.id }).from(syncJobs).where(eq(syncJobs.id, jobId));
  if (!job) return apiError(404, "RequestNotFound", "That request does not exist");

  const comments = await listSyncJobComments(db, jobId);
  return json({ job_id: jobId, comments: comments.map(commentDto) });
}

const bodySchema = z.object({
  challenge: z.object({ prefix: z.string(), nonce: z.string() }),
  job_id: z.number().int().positive(),
  body: z.string().trim().min(1).max(MAX_COMMENT_BODY_CHARS),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Invalid request body");
  }

  // Identity: shared Supabase accounts with karafilt.com.
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(401, "Unauthorized", "Sign in to comment");

  // Separate bucket from lyric comments on purpose: discussing requests
  // shouldn't eat the budget for annotating published lyrics (or vice versa).
  const store = getKvStore();
  const { allowed } = await checkRateLimit(
    store,
    `jobcomment:${user.id}`,
    RATE_LIMITS.comment.limit,
    RATE_LIMITS.comment.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Too many comments; try again later");

  const verdict = await verifyAndConsumeSolution(store, body.challenge.prefix, body.challenge.nonce);
  if (!verdict.ok) {
    return apiError(400, "IncorrectChallenge", `Challenge verification failed: ${verdict.reason}`);
  }

  // Any status: discussing a rejected or finished request is legitimate.
  const db = getDb();
  const [job] = await db
    .select({ id: syncJobs.id })
    .from(syncJobs)
    .where(eq(syncJobs.id, body.job_id));
  if (!job) return apiError(404, "RequestNotFound", "That request does not exist");

  // Snapshot the author's own display name (own-row RLS read), so later
  // renames don't rewrite history.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const comment = await insertSyncJobComment(db, {
    jobId: job.id,
    body: body.body,
    authorUserId: user.id,
    authorName: profile?.display_name?.trim() || null,
  });

  return json(commentDto(comment), { status: 201 });
}

export const OPTIONS = corsOptions;
