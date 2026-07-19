import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { type SyncJob } from "@/lib/db/schema";
import { isAdminRequest } from "@/lib/admin";
import { apiError, json } from "@/lib/api-helpers";
import { moderateSyncJob } from "@/lib/sync-queue/core";

const bodySchema = z.object({
  job_id: z.number().int().positive(),
  action: z.enum(["approve", "reject", "cancel", "retry"]),
  reason: z.string().max(500).optional(),
});

function jobDto(j: SyncJob) {
  return {
    id: j.id,
    source: j.source,
    status: j.status,
    video_key: j.videoKey,
    video_url: j.videoUrl,
    artist_name: j.artistName,
    track_name: j.trackName,
    album_name: j.albumName,
    duration_seconds: j.durationSeconds,
    submitter_user_id: j.submitterUserId,
    submitter_name: j.submitterName,
    attempts: j.attempts,
    max_attempts: j.maxAttempts,
    claimed_by: j.claimedBy,
    lease_expires_at: j.leaseExpiresAt,
    next_attempt_at: j.nextAttemptAt,
    last_error: j.lastError,
    rejection_reason: j.rejectionReason,
    result_track_id: j.resultTrackId,
    result_revision_id: j.resultRevisionId,
    created_at: j.createdAt,
    updated_at: j.updatedAt,
  };
}

export async function POST(req: Request) {
  if (!isAdminRequest(req)) return apiError(401, "Unauthorized", "Admin token required");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return apiError(400, "BadRequest", "Expected { job_id, action, reason? }");
  }

  const job = await moderateSyncJob(getDb(), body.job_id, body.action, body.reason);
  if (!job) {
    return apiError(
      409,
      "Conflict",
      "Job is not in a state that allows this action, or the video's queue slot is taken again"
    );
  }

  return json({ job: jobDto(job) });
}
