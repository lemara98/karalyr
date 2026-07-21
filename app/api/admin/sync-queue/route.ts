import { getDb } from "@/lib/db/client";
import { type SyncJob, type SyncJobStatus } from "@/lib/db/schema";
import { isAdminRequest } from "@/lib/admin";
import { apiError, json } from "@/lib/api-helpers";
import { countJobVoters, listWantedSources } from "@/lib/db/queries";
import { listSyncJobs } from "@/lib/sync-queue/core";

function jobDto(j: SyncJob) {
  const lines = j.plainLyrics.split("\n").filter(Boolean);
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
    lyrics_preview: lines.slice(0, 10),
    line_count: lines.length,
  };
}

const VIEWS: Record<string, { statuses: SyncJobStatus[]; limit?: number; newestFirst: boolean }> = {
  // Demand waiting on a decision: promote one once you have a lawful way to
  // get its audio. pending_approval rides along for rows predating "wanted".
  wanted: { statuses: ["wanted", "pending_approval"], newestFirst: false },
  active: { statuses: ["queued", "processing"], newestFirst: false },
  recent: { statuses: ["done", "failed", "rejected", "cancelled"], limit: 50, newestFirst: true },
};

export async function GET(req: Request) {
  if (!(await isAdminRequest())) return apiError(401, "Unauthorized", "Admin access required");

  const status = new URL(req.url).searchParams.get("status") ?? "recent";
  const view = VIEWS[status] ?? VIEWS.recent;

  const db = getDb();
  const jobs = await listSyncJobs(db, view);

  // Demand and every link anyone offered. Dedup collapses on song identity, so
  // the display link is only one of possibly several — the operator needs all
  // of them to pick which recording to actually work from.
  const enriched = await Promise.all(
    jobs.map(async (j) => ({
      ...jobDto(j),
      voters: await countJobVoters(db, j.id),
      sources: await listWantedSources(db, j.id),
    }))
  );
  return json({ jobs: enriched });
}
