import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  SYNC_JOB_ACTIVE_STATUSES,
  syncJobs,
  type SyncJob,
  type SyncJobSource,
  type SyncJobStatus,
} from "../db/schema";
import { stripToPlainLines } from "../formats";
import { deriveVideoKey } from "../video-key";

/**
 * State machine for the word-sync request queue (see the syncJobs table).
 * Every transition is a guarded UPDATE — the WHERE re-checks the expected
 * status (and owner, for worker calls) so a stale actor gets `null` back
 * instead of clobbering someone else's transition. Nothing here holds a
 * transaction open: single-statement atomicity is all SQLite/Turso need.
 */

export const MIN_LYRIC_LINES = 4;
export const MAX_LYRICS_CHARS = 50_000;
/** Extension re-submissions of a recently failed video are refused this long. */
export const RECENT_FAILURE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** Retry backoff after a non-permanent failure: attempts × this. */
export const RETRY_BACKOFF_MS = 30 * 60 * 1000;
/** Delay before a lease-expired job may be claimed again. */
export const RECLAIM_DELAY_MS = 10 * 60 * 1000;
export const DEFAULT_LEASE_MS = 45 * 60 * 1000;

export type EnqueueRejection =
  | "AlreadySynced"
  | "AlreadyQueued"
  | "RecentlyFailed"
  | "UnsupportedSource"
  | "BadLyrics";

export interface EnqueueInput {
  source: SyncJobSource;
  videoUrl: string;
  artistName: string;
  trackName: string;
  albumName?: string | null;
  durationSeconds?: number | null;
  /** Plain text or (enhanced) LRC — timing tags are stripped here. */
  rawLyrics: string;
  submitterUserId: string;
  submitterName?: string | null;
}

export type EnqueueResult =
  | { ok: true; job: SyncJob }
  | { ok: false; code: EnqueueRejection; trackId?: number };

function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps the LibsqlError ("UNIQUE constraint failed: …") in a
  // "Failed query: …" error, so walk the cause chain.
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (e.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}

export async function enqueueSyncJob(
  db: Db,
  input: EnqueueInput,
  now = Date.now()
): Promise<EnqueueResult> {
  const videoKey = deriveVideoKey(input.videoUrl);
  // Only YouTube: the worker fetches audio with yt-dlp.
  if (!videoKey?.startsWith("yt:")) return { ok: false, code: "UnsupportedSource" };

  const plainLyrics = stripToPlainLines(input.rawLyrics);
  if (
    plainLyrics.length > MAX_LYRICS_CHARS ||
    plainLyrics.split("\n").filter(Boolean).length < MIN_LYRIC_LINES
  ) {
    return { ok: false, code: "BadLyrics" };
  }

  // Layer 1: the video's track already has word-timed lyrics. Tier is
  // deliberately not the test — a community *line*-synced revision can be the
  // best one and the track still wants word sync. pending_review counts too:
  // a queue import under a verified best revision lands there (Rule C), and
  // without this the same video would be re-queued and re-aligned repeatedly
  // while the revision waits for review.
  const synced = await db.all<{ track_id: number }>(sql`
    SELECT tv.track_id FROM track_videos tv
    JOIN revisions r ON r.track_id = tv.track_id
    WHERE tv.video_key = ${videoKey}
      AND r.status IN ('active', 'pending_review')
      AND json_extract(r.payload, '$.meta.has_word_timing') = 1
    LIMIT 1
  `);
  if (synced.length > 0) {
    return { ok: false, code: "AlreadySynced", trackId: synced[0].track_id };
  }

  // Layer 2: a live job already holds this video's slot.
  const [live] = await db
    .select()
    .from(syncJobs)
    .where(
      and(eq(syncJobs.videoKey, videoKey), inArray(syncJobs.status, SYNC_JOB_ACTIVE_STATUSES))
    )
    .limit(1);
  if (live) return { ok: false, code: "AlreadyQueued" };

  // Layer 3 (extension only): auto-triggered clients shouldn't hammer a video
  // that just failed. Human-initiated website submissions may retry freely.
  if (input.source === "extension") {
    const [failed] = await db
      .select({ id: syncJobs.id })
      .from(syncJobs)
      .where(
        and(
          eq(syncJobs.videoKey, videoKey),
          eq(syncJobs.status, "failed"),
          gte(syncJobs.updatedAt, now - RECENT_FAILURE_COOLDOWN_MS)
        )
      )
      .limit(1);
    if (failed) return { ok: false, code: "RecentlyFailed" };
  }

  try {
    const [job] = await db
      .insert(syncJobs)
      .values({
        source: input.source,
        status: input.source === "extension" ? "queued" : "pending_approval",
        videoKey,
        videoUrl: input.videoUrl.trim(),
        artistName: input.artistName.trim(),
        trackName: input.trackName.trim(),
        albumName: input.albumName?.trim() || null,
        durationSeconds: input.durationSeconds ?? null,
        plainLyrics,
        submitterUserId: input.submitterUserId,
        submitterName: input.submitterName?.trim() || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { ok: true, job };
  } catch (err) {
    // Lost the read-then-insert race — the partial unique index caught it.
    if (isUniqueViolation(err)) return { ok: false, code: "AlreadyQueued" };
    throw err;
  }
}

/**
 * Atomically claim the oldest eligible queued job. Also sweeps expired
 * leases first: crashed workers' jobs go back to queued (with a delay) or to
 * failed once out of attempts. Safe with any number of concurrent workers —
 * the claim is a single UPDATE whose WHERE re-checks the row is still queued.
 */
export async function claimNextJob(
  db: Db,
  workerId: string,
  leaseMs = DEFAULT_LEASE_MS,
  now = Date.now()
): Promise<SyncJob | null> {
  await db
    .update(syncJobs)
    .set({
      status: "queued",
      claimedBy: null,
      leaseExpiresAt: null,
      nextAttemptAt: now + RECLAIM_DELAY_MS,
      updatedAt: now,
    })
    .where(
      and(
        eq(syncJobs.status, "processing"),
        lt(syncJobs.leaseExpiresAt, now),
        sql`${syncJobs.attempts} < ${syncJobs.maxAttempts}`
      )
    );
  await db
    .update(syncJobs)
    .set({
      status: "failed",
      claimedBy: null,
      leaseExpiresAt: null,
      lastError: "worker lease expired",
      updatedAt: now,
    })
    .where(
      and(
        eq(syncJobs.status, "processing"),
        lt(syncJobs.leaseExpiresAt, now),
        sql`${syncJobs.attempts} >= ${syncJobs.maxAttempts}`
      )
    );

  const [claimed] = await db
    .update(syncJobs)
    .set({
      status: "processing",
      claimedBy: workerId,
      leaseExpiresAt: now + leaseMs,
      attempts: sql`${syncJobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(syncJobs.status, "queued"),
        sql`${syncJobs.id} = (
          SELECT id FROM sync_jobs
          WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
          ORDER BY created_at ASC, id ASC LIMIT 1
        )`
      )
    )
    .returning();
  return claimed ?? null;
}

/** Extend the lease. `null` means the caller no longer owns the job — abort the run. */
export async function heartbeatJob(
  db: Db,
  id: number,
  workerId: string,
  leaseMs = DEFAULT_LEASE_MS,
  now = Date.now()
): Promise<SyncJob | null> {
  const [job] = await db
    .update(syncJobs)
    .set({ leaseExpiresAt: now + leaseMs, updatedAt: now })
    .where(ownedProcessing(id, workerId))
    .returning();
  return job ?? null;
}

/** The job as currently owned by this worker, or null. Complete does a
 * pre-check with this before running the (non-reversible) revision import. */
export async function getOwnedProcessingJob(
  db: Db,
  id: number,
  workerId: string
): Promise<SyncJob | null> {
  const [job] = await db.select().from(syncJobs).where(ownedProcessing(id, workerId)).limit(1);
  return job ?? null;
}

export async function completeJob(
  db: Db,
  id: number,
  workerId: string,
  result: { trackId: number; revisionId: number },
  now = Date.now()
): Promise<SyncJob | null> {
  const [job] = await db
    .update(syncJobs)
    .set({
      status: "done",
      claimedBy: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      lastError: null,
      resultTrackId: result.trackId,
      resultRevisionId: result.revisionId,
      updatedAt: now,
    })
    .where(ownedProcessing(id, workerId))
    .returning();
  return job ?? null;
}

export async function failJob(
  db: Db,
  id: number,
  workerId: string,
  error: string,
  permanent: boolean,
  now = Date.now()
): Promise<SyncJob | null> {
  const owned = await getOwnedProcessingJob(db, id, workerId);
  if (!owned) return null;
  const buried = permanent || owned.attempts >= owned.maxAttempts;
  // The guarded WHERE below re-checks ownership, so losing the lease between
  // the read and this write just yields null.
  const [job] = await db
    .update(syncJobs)
    .set(
      buried
        ? {
            status: "failed",
            claimedBy: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            lastError: error,
            updatedAt: now,
          }
        : {
            status: "queued",
            claimedBy: null,
            leaseExpiresAt: null,
            nextAttemptAt: now + RETRY_BACKOFF_MS * owned.attempts,
            lastError: error,
            updatedAt: now,
          }
    )
    .where(ownedProcessing(id, workerId))
    .returning();
  return job ?? null;
}

function ownedProcessing(id: number, workerId: string) {
  return and(
    eq(syncJobs.id, id),
    eq(syncJobs.status, "processing"),
    eq(syncJobs.claimedBy, workerId)
  );
}

export type ModerateAction = "approve" | "reject" | "cancel" | "retry";

const MODERATE_FROM: Record<ModerateAction, SyncJobStatus[]> = {
  approve: ["pending_approval"],
  reject: ["pending_approval"],
  cancel: ["pending_approval", "queued"],
  retry: ["failed"],
};

/** Admin transition. `null` = the job wasn't in an allowed state (or, for
 * retry, another live job for the same video now exists) — report a conflict. */
export async function moderateSyncJob(
  db: Db,
  id: number,
  action: ModerateAction,
  reason?: string,
  now = Date.now()
): Promise<SyncJob | null> {
  const set =
    action === "approve"
      ? { status: "queued" as const, updatedAt: now }
      : action === "reject"
        ? { status: "rejected" as const, rejectionReason: reason?.trim() || null, updatedAt: now }
        : action === "cancel"
          ? { status: "cancelled" as const, updatedAt: now }
          : {
              status: "queued" as const,
              attempts: 0,
              nextAttemptAt: null,
              lastError: null,
              updatedAt: now,
            };
  try {
    const [job] = await db
      .update(syncJobs)
      .set(set)
      .where(and(eq(syncJobs.id, id), inArray(syncJobs.status, MODERATE_FROM[action])))
      .returning();
    return job ?? null;
  } catch (err) {
    // retry: failed → queued re-enters the active set; someone else already
    // holds this video's slot.
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function listSyncJobs(
  db: Db,
  opts: { statuses?: SyncJobStatus[]; limit?: number; newestFirst?: boolean } = {}
): Promise<SyncJob[]> {
  const { statuses, limit = 100, newestFirst = false } = opts;
  const order = newestFirst
    ? [desc(syncJobs.createdAt), desc(syncJobs.id)]
    : [asc(syncJobs.createdAt), asc(syncJobs.id)];
  const base = db.select().from(syncJobs);
  const query = statuses?.length ? base.where(inArray(syncJobs.status, statuses)) : base;
  return query.orderBy(...order).limit(limit);
}

/** Backpressure input for the intake routes' QueueFull valve. */
export async function countQueuedJobs(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(syncJobs)
    .where(eq(syncJobs.status, "queued"));
  return row?.n ?? 0;
}
