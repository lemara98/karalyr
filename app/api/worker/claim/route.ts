import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { apiError, json } from "@/lib/api-helpers";
import { claimNextJob } from "@/lib/sync-queue/core";
import { isWorkerRequest } from "@/lib/worker-auth";

const bodySchema = z.object({
  worker_id: z.string().min(1).max(100),
  lease_seconds: z.number().int().min(60).max(7200).default(2700),
});

export async function POST(req: Request) {
  if (!isWorkerRequest(req)) return apiError(401, "Unauthorized", "Worker token required");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Invalid request body");
  }

  const job = await claimNextJob(getDb(), body.worker_id, body.lease_seconds * 1000);
  if (!job) return new Response(null, { status: 204 });

  return json({
    job: {
      id: job.id,
      video_url: job.videoUrl,
      plain_lyrics: job.plainLyrics,
      artist_name: job.artistName,
      track_name: job.trackName,
      album_name: job.albumName,
      duration_seconds: job.durationSeconds,
      attempts: job.attempts,
      max_attempts: job.maxAttempts,
      lease_expires_at: job.leaseExpiresAt,
    },
  });
}
