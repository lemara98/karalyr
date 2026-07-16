import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { insertLyricComment, listLyricComments } from "@/lib/db/queries";
import { revisions, tracks, type LyricComment } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { MAX_COMMENT_BODY_CHARS, quoteForRange, validateLineRange } from "@/lib/comments";
import { validatePayload } from "@/lib/formats";
import { verifyAndConsumeSolution } from "@/lib/pow";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getKvStore } from "@/lib/stores/memory";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

function commentDto(c: LyricComment) {
  return {
    id: c.id,
    revision_id: c.revisionId,
    start_line: c.startLine,
    end_line: c.endLine,
    quote: c.quote,
    body: c.body,
    author_name: c.authorName ?? "Anonymous",
    created_at: c.createdAt,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (!Number.isFinite(trackId)) {
    return apiError(400, "BadRequest", "Track id must be a number");
  }

  const db = getDb();
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) return apiError(404, "TrackNotFound", "Failed to find specified track");

  const comments = await listLyricComments(db, trackId);
  return json({
    track_id: track.id,
    best_revision_id: track.bestRevisionId,
    comments: comments.map(commentDto),
  });
}

const bodySchema = z.object({
  challenge: z.object({ prefix: z.string(), nonce: z.string() }),
  start_line: z.number().int().min(0),
  end_line: z.number().int().min(0),
  body: z.string().trim().min(1).max(MAX_COMMENT_BODY_CHARS),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (!Number.isFinite(trackId)) {
    return apiError(400, "BadRequest", "Track id must be a number");
  }

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

  const store = getKvStore();
  const { allowed } = await checkRateLimit(
    store,
    `comment:${user.id}`,
    RATE_LIMITS.comment.limit,
    RATE_LIMITS.comment.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Comment rate limit exceeded");

  const verdict = await verifyAndConsumeSolution(store, body.challenge.prefix, body.challenge.nonce);
  if (!verdict.ok) {
    return apiError(400, "IncorrectChallenge", `Challenge verification failed: ${verdict.reason}`);
  }

  const db = getDb();
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) return apiError(404, "TrackNotFound", "Failed to find specified track");
  const best =
    track.bestRevisionId != null
      ? (await db.select().from(revisions).where(eq(revisions.id, track.bestRevisionId)))[0]
      : undefined;
  if (!best) return apiError(409, "NoLyrics", "Track has no lyrics to comment on");

  const payload = validatePayload(JSON.parse(best.payload));
  const rangeError = validateLineRange(body.start_line, body.end_line, payload.lines.length);
  if (rangeError) return apiError(400, "BadRequest", rangeError);

  // Display name from the user's own profiles row (own-row read passes RLS);
  // snapshotted so later renames don't rewrite old comments.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const comment = await insertLyricComment(db, {
    trackId: track.id,
    revisionId: best.id,
    startLine: body.start_line,
    endLine: body.end_line,
    quote: quoteForRange(payload, body.start_line, body.end_line),
    body: body.body,
    authorUserId: user.id,
    authorName: profile?.display_name?.trim() || null,
  });

  return json(commentDto(comment), { status: 201 });
}

export const OPTIONS = corsOptions;
