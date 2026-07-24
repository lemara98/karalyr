import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { apiError, json } from "@/lib/api-helpers";
import { importAlignedPayload } from "@/lib/aligned-import";
import { FormatError, validatePayload, type LyricsPayload } from "@/lib/formats";
import { completeJob, getOwnedProcessingJob } from "@/lib/sync-queue/core";
import { isWorkerRequest } from "@/lib/worker-auth";

const bodySchema = z.object({
  worker_id: z.string().min(1).max(100),
  payload: z.unknown(),
  // yt-dlp metadata; the job's intake fields win when present (artist/track
  // are non-null at intake, so in practice meta only ever fills duration).
  // Deliberately tolerant: align.py can leave placeholder strings in the
  // sidecar ("SECONDS") and the daemon sends null when the file is missing —
  // bad meta must never 400 an otherwise valid payload (the daemon treats a
  // /complete 400 as a permanent failure).
  meta: z
    .object({
      artist: z.string().optional().catch(undefined),
      title: z.string().optional().catch(undefined),
      duration: z.number().positive().optional().catch(undefined),
    })
    .nullish()
    .catch(undefined),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isWorkerRequest(req)) return apiError(401, "Unauthorized", "Worker token required");

  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return apiError(400, "BadRequest", "Job id must be a positive integer");
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Invalid request body");
  }

  const db = getDb();
  const job = await getOwnedProcessingJob(db, jobId, body.worker_id);
  if (!job) return apiError(409, "NotOwner", "Job is not processing under this worker");

  // On invalid payload the job stays processing — the worker follows up with
  // a permanent /fail.
  let payload: LyricsPayload;
  try {
    payload = validatePayload(body.payload);
  } catch (err) {
    if (err instanceof FormatError) return apiError(400, "InvalidPayload", err.message);
    throw err;
  }

  const artist = job.artistName || body.meta?.artist?.trim() || "";
  const track = job.trackName || body.meta?.title?.trim() || "";
  if (!artist || !track) return apiError(400, "BadRequest", "Job has no artist or track name");
  const duration = job.durationSeconds ?? body.meta?.duration;
  if (duration == null) {
    return apiError(400, "MissingDuration", "No duration on the job or in meta");
  }

  let imported;
  try {
    imported = await importAlignedPayload(db, {
      payload,
      artist,
      track,
      album: job.albumName,
      duration,
      videoUrl: job.videoUrl,
      submitterFingerprint: "system:sync-queue",
    });
  } catch (err) {
    // Word-timing guard: a line-level payload is a failed alignment; the 400
    // makes the daemon issue a permanent /fail for this job.
    if (err instanceof FormatError) return apiError(400, "InvalidPayload", err.message);
    throw err;
  }

  // Lease lost mid-import: the revision already landed and stays — aligned
  // lyrics are worth keeping regardless of queue bookkeeping. The 409 only
  // tells this worker to stop touching the job.
  const done = await completeJob(db, jobId, body.worker_id, {
    trackId: imported.trackId,
    revisionId: imported.revisionId,
  });
  if (!done) return apiError(409, "NotOwner", "Lease lost during import");

  return json({
    track_id: imported.trackId,
    revision_id: imported.revisionId,
    revision_status: imported.revisionStatus,
  });
}
