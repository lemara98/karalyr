import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getKvStore } from "@/lib/stores/memory";
import { countQueuedJobs, enqueueSyncJob } from "@/lib/sync-queue/core";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

/** Backpressure valve: refuse submissions once this many jobs are queued. */
const MAX_QUEUED_JOBS = 500;

const bodySchema = z.object({
  // Optional: a request needs only an artist and a title. A link, when given,
  // is kept so the song stays traceable to somewhere it can be heard.
  video_url: z.string().max(500).nullish(),
  artist_name: z.string().min(1).max(500),
  track_name: z.string().min(1).max(500),
  album_name: z.string().max(500).nullish(),
  duration: z.number().positive().nullish(),
  lyrics: z.string().min(1).max(60_000),
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
  if (!user) return apiError(401, "Unauthorized", "Sign in to request a sync");

  const { allowed } = await checkRateLimit(
    getKvStore(),
    `syncq:${user.id}`,
    RATE_LIMITS.syncQueueSubmit.limit,
    RATE_LIMITS.syncQueueSubmit.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Sync request rate limit exceeded");

  const db = getDb();
  if ((await countQueuedJobs(db)) >= MAX_QUEUED_JOBS) {
    return apiError(503, "QueueFull", "The sync queue is full; try again later");
  }

  // Display name from the user's own profiles row (own-row read passes RLS).
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const result = await enqueueSyncJob(db, {
    source: "website",
    videoUrl: body.video_url,
    artistName: body.artist_name,
    trackName: body.track_name,
    albumName: body.album_name,
    durationSeconds: body.duration,
    rawLyrics: body.lyrics,
    submitterUserId: user.id,
    submitterName: profile?.display_name?.trim() || null,
  });

  if (!result.ok) {
    switch (result.code) {
      case "AlreadySynced":
        return json(
          {
            code: 409,
            name: "AlreadySynced",
            message: "This song already has word-synced lyrics",
            track_id: result.trackId ?? null,
          },
          { status: 409 }
        );
      case "RecentlyFailed":
        return apiError(409, "RecentlyFailed", "This song failed to sync recently; try again later");
      case "UnsupportedSource":
        return apiError(400, "UnsupportedSource", "That link isn't a recognised YouTube or Spotify URL");
      case "BadLyrics":
        return apiError(400, "BadLyrics", "Lyrics are too short or too long to align");
    }
  }

  // 200 when this joined an existing request, 201 when it opened a new one.
  return json(
    { job_id: result.job.id, status: result.job.status, voted: result.voted },
    { status: result.voted ? 200 : 201 }
  );
}

export const OPTIONS = corsOptions;
