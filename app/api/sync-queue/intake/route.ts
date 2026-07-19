import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getKvStore } from "@/lib/stores/memory";
import { countQueuedJobs, enqueueSyncJob } from "@/lib/sync-queue/core";
import { deriveVideoKey } from "@/lib/video-key";
import { isIntakeRequest } from "@/lib/worker-auth";

/** Backpressure valve: refuse intake once this many jobs are queued. */
const MAX_QUEUED_JOBS = 500;

const bodySchema = z
  .object({
    video_url: z.string().min(1).max(500),
    artist_name: z.string().min(1).max(500),
    track_name: z.string().min(1).max(500),
    album_name: z.string().max(500).nullish(),
    duration: z.number().positive().nullish(),
    synced_lyrics: z.string().max(60_000).nullish(),
    plain_lyrics: z.string().max(60_000).nullish(),
    submitter: z.object({
      user_id: z.string().min(1).max(100),
      display_name: z.string().max(200).nullish(),
    }),
    client: z.string().max(100).nullish(),
  })
  .refine((b) => b.synced_lyrics != null || b.plain_lyrics != null, {
    message: "Provide synced_lyrics or plain_lyrics",
  });

/** Trusted proxy intake from the karafilt.com website (extension submissions). */
export async function POST(req: Request) {
  if (!isIntakeRequest(req)) return apiError(401, "Unauthorized", "Intake secret required");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Invalid request body");
  }

  // Reject non-YouTube sources before consuming the submitter's daily rate
  // budget — auto-triggered clients must not pay for guaranteed rejections.
  if (!deriveVideoKey(body.video_url)?.startsWith("yt:")) {
    return apiError(400, "UnsupportedSource", "Only YouTube videos can be synced");
  }

  const { allowed } = await checkRateLimit(
    getKvStore(),
    `syncq:${body.submitter.user_id}`,
    RATE_LIMITS.syncQueueIntake.limit,
    RATE_LIMITS.syncQueueIntake.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Sync request rate limit exceeded");

  const db = getDb();
  if ((await countQueuedJobs(db)) >= MAX_QUEUED_JOBS) {
    return apiError(503, "QueueFull", "The sync queue is full; try again later");
  }

  const result = await enqueueSyncJob(db, {
    source: "extension",
    videoUrl: body.video_url,
    artistName: body.artist_name,
    trackName: body.track_name,
    albumName: body.album_name,
    durationSeconds: body.duration,
    rawLyrics: body.synced_lyrics ?? body.plain_lyrics ?? "",
    submitterUserId: body.submitter.user_id,
    submitterName: body.submitter.display_name,
  });

  if (!result.ok) {
    switch (result.code) {
      case "AlreadySynced":
        // apiError shape + the track so the client can link to it.
        return json(
          {
            code: 409,
            name: "AlreadySynced",
            message: "This video already has word-synced lyrics",
            track_id: result.trackId ?? null,
          },
          { status: 409 }
        );
      case "AlreadyQueued":
        return apiError(409, "AlreadyQueued", "A sync job for this video already exists");
      case "RecentlyFailed":
        return apiError(409, "RecentlyFailed", "This video failed to sync recently; try again later");
      case "UnsupportedSource":
        return apiError(400, "UnsupportedSource", "Only YouTube videos can be synced");
      case "BadLyrics":
        return apiError(400, "BadLyrics", "Lyrics are too short or too long to align");
    }
  }

  return json({ job_id: result.job.id, status: result.job.status }, { status: 201 });
}

export const OPTIONS = corsOptions;
