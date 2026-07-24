import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  SYNC_JOB_ACTIVE_STATUSES,
  syncJobVotes,
  syncJobs,
  tracks,
  type SyncJob,
  type SyncJobSource,
  type SyncJobStatus,
} from "../db/schema";
import { stripToPlainLines } from "../formats";
import { songKey } from "../song-key";
import { deriveVideoKey, pickPreferredVideoKey } from "../video-key";

/**
 * State machine for the word-sync demand queue (see the syncJobs table).
 * Every transition is a guarded UPDATE — the WHERE re-checks the expected
 * status (and owner, for worker calls) so a stale actor gets `null` back
 * instead of clobbering someone else's transition. Nothing here holds a
 * transaction open: single-statement atomicity is all SQLite/Turso need.
 *
 * Intake records *demand*: a request lands as "wanted" and never as "queued",
 * because "queued" is the only status the pull worker can claim. Promotion is
 * an explicit admin action, so nothing a user does can trigger a fetch.
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

// Note there is no "AlreadyQueued": a second request for a song someone has
// already asked for is the point of a demand queue, so it records a vote and
// succeeds.
export type EnqueueRejection =
  | "AlreadySynced"
  | "RecentlyFailed"
  | "UnsupportedSource"
  | "BadLyrics";

export interface EnqueueInput {
  source: SyncJobSource;
  /**
   * Optional link to where the song can be heard. A want needs only an artist
   * and a title; when a link is given it is kept for tracing (and per-voter on
   * syncJobVotes), never as a promise that anything will fetch it.
   */
  videoUrl?: string | null;
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
  | { ok: true; job: SyncJob; voted: boolean }
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
  // A link is optional, but one that was supplied has to parse — quietly
  // dropping a typo'd URL would throw away the only trace back to the song.
  const videoUrl = input.videoUrl?.trim() || null;
  const videoKey = videoUrl ? deriveVideoKey(videoUrl) : null;
  if (videoUrl && !videoKey) return { ok: false, code: "UnsupportedSource" };

  const plainLyrics = stripToPlainLines(input.rawLyrics);
  if (
    plainLyrics.length > MAX_LYRICS_CHARS ||
    plainLyrics.split("\n").filter(Boolean).length < MIN_LYRIC_LINES
  ) {
    return { ok: false, code: "BadLyrics" };
  }

  const key = songKey(input.artistName, input.trackName);

  // Layer 1: the song already has word-timed lyrics. Tier is deliberately not
  // the test — a community *line*-synced revision can be the best one and the
  // track still wants word sync. pending_review counts too: an import under a
  // verified best revision lands there (Rule C), and without this the same
  // song would be re-requested and re-aligned while it waits for review.
  const syncedTrackId = await findSyncedTrack(db, key, videoKey);
  if (syncedTrackId !== null) {
    return { ok: false, code: "AlreadySynced", trackId: syncedTrackId };
  }

  // Layer 2: someone already wants this song — record a vote on their request
  // rather than opening a second one.
  const live = await findLiveRequest(db, key);
  if (live) return { ok: true, job: await addVote(db, live, input, videoKey, videoUrl, now), voted: true };

  // Layer 3 (extension only): auto-triggered clients shouldn't re-file a song
  // that just failed. Human-initiated website requests may retry freely.
  if (input.source === "extension") {
    const [failed] = await db
      .select({ id: syncJobs.id })
      .from(syncJobs)
      .where(
        and(
          eq(syncJobs.songKey, key),
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
        // Always "wanted": no public path may reach a worker-claimable status.
        status: "wanted",
        songKey: key,
        videoKey,
        videoUrl,
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
    // The requester counts as the first voter, so demand is never zero.
    await recordVote(db, job.id, input.submitterUserId, videoKey, videoUrl, now);
    return { ok: true, job, voted: false };
  } catch (err) {
    // Lost the read-then-insert race — the partial unique index caught it, so
    // the winner's request is the one to vote on.
    if (isUniqueViolation(err)) {
      const winner = await findLiveRequest(db, key);
      if (winner) {
        return { ok: true, job: await addVote(db, winner, input, videoKey, videoUrl, now), voted: true };
      }
    }
    throw err;
  }
}

function findLiveRequest(db: Db, key: string): Promise<SyncJob | undefined> {
  return db
    .select()
    .from(syncJobs)
    .where(and(eq(syncJobs.songKey, key), inArray(syncJobs.status, SYNC_JOB_ACTIVE_STATUSES)))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * Track id if this song already has word-timed lyrics, else null. Checked by
 * video key first (exact and indexed), then by song identity so a want with no
 * link — or with a link nobody has mapped yet — is still recognised.
 */
async function findSyncedTrack(
  db: Db,
  key: string,
  videoKey: string | null
): Promise<number | null> {
  if (videoKey) {
    const byVideo = await db.all<{ track_id: number }>(sql`
      SELECT tv.track_id FROM track_videos tv
      JOIN revisions r ON r.track_id = tv.track_id
      WHERE tv.video_key = ${videoKey}
        AND r.status IN ('active', 'pending_review')
        AND json_extract(r.payload, '$.meta.has_word_timing') = 1
      LIMIT 1
    `);
    if (byVideo.length > 0) return byVideo[0].track_id;
  }

  // Song identity has to be compared in JS (songKey folds diacritics and
  // strips upload noise, which SQL can't reproduce), so this scans the tracks
  // that already have word timing — a small set relative to the library. If
  // that set ever gets large, denormalise song_key onto tracks and index it.
  const candidates = await db.all<{ id: number; artist_name: string; track_name: string }>(sql`
    SELECT DISTINCT t.id, t.artist_name, t.track_name
    FROM tracks t
    JOIN revisions r ON r.track_id = t.id
    WHERE r.status IN ('active', 'pending_review')
      AND json_extract(r.payload, '$.meta.has_word_timing') = 1
  `);
  return candidates.find((c) => songKey(c.artist_name, c.track_name) === key)?.id ?? null;
}

/** Vote on an existing request, and let a better link upgrade its display source. */
async function addVote(
  db: Db,
  job: SyncJob,
  input: EnqueueInput,
  videoKey: string | null,
  videoUrl: string | null,
  now: number
): Promise<SyncJob> {
  await recordVote(db, job.id, input.submitterUserId, videoKey, videoUrl, now);
  if (!videoKey || !videoUrl || job.videoKey === videoKey) return job;

  // An embeddable yt: link beats an audio-only sp: card; keep whichever
  // pickPreferredVideoKey would choose for a track page.
  const preferred = pickPreferredVideoKey([
    ...(job.videoKey ? [{ videoKey: job.videoKey, createdAt: job.createdAt }] : []),
    { videoKey, createdAt: now },
  ]);
  if (preferred !== videoKey) return job;

  const [updated] = await db
    .update(syncJobs)
    .set({ videoKey, videoUrl, updatedAt: now })
    .where(eq(syncJobs.id, job.id))
    .returning();
  return updated ?? job;
}

/**
 * One vote per person per request. The source they offered rides along: with
 * dedup on song identity this is the only place a second or third link for the
 * same song survives.
 */
async function recordVote(
  db: Db,
  jobId: number,
  userId: string,
  videoKey: string | null,
  videoUrl: string | null,
  now: number
): Promise<void> {
  try {
    await db.insert(syncJobVotes).values({ jobId, userId, videoKey, videoUrl, createdAt: now });
  } catch (err) {
    // The same person asking twice is a no-op, not an error.
    if (!isUniqueViolation(err)) throw err;
  }
}

/**
 * Close every open request for a track that just gained word-timed lyrics,
 * whichever path produced them (worker import, local align, or a direct
 * upload). Leaves "processing" alone — a worker owns that row
 * and reports its own outcome. Returns how many were closed.
 */
export async function resolveWantedForTrack(
  db: Db,
  trackId: number,
  now = Date.now()
): Promise<number> {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) return 0;
  const closed = await db
    .update(syncJobs)
    .set({ status: "done", resultTrackId: trackId, updatedAt: now })
    .where(
      and(
        eq(syncJobs.songKey, songKey(track.artistName, track.trackName)),
        inArray(syncJobs.status, ["wanted", "pending_approval", "queued"])
      )
    )
    .returning({ id: syncJobs.id });
  return closed.length;
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

export type ModerateAction = "promote" | "approve" | "reject" | "cancel" | "retry";

const MODERATE_FROM: Record<ModerateAction, SyncJobStatus[]> = {
  // The only way into "queued" — i.e. the only way a request becomes work the
  // pull worker can claim. Deliberately admin-only, so the operator decides
  // per song that they have a lawful way to get the audio.
  promote: ["wanted"],
  approve: ["pending_approval"],
  reject: ["wanted", "pending_approval"],
  cancel: ["wanted", "pending_approval", "queued"],
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
    action === "promote" || action === "approve"
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

export type EditLyricsResult =
  | { ok: true; lineCount: number }
  | { ok: false; reason: "bad_lyrics" | "not_editable" };

/**
 * Admin correction of a candidate's submitted lyrics — the text the aligner
 * will read. Same normalization and bounds as intake. Guarded update, same
 * as every other transition here: editable only while the job is waiting
 * (a processing job belongs to its worker; closed jobs are history).
 */
export async function editJobLyrics(
  db: Db,
  jobId: number,
  rawLyrics: string,
  now: number
): Promise<EditLyricsResult> {
  const plainLyrics = stripToPlainLines(rawLyrics);
  const lineCount = plainLyrics.split("\n").filter(Boolean).length;
  if (plainLyrics.length > MAX_LYRICS_CHARS || lineCount < MIN_LYRIC_LINES) {
    return { ok: false, reason: "bad_lyrics" };
  }

  const updated = await db
    .update(syncJobs)
    .set({ plainLyrics, updatedAt: now })
    .where(
      and(
        eq(syncJobs.id, jobId),
        inArray(syncJobs.status, ["wanted", "pending_approval", "queued"])
      )
    )
    .returning({ id: syncJobs.id });
  if (updated.length === 0) return { ok: false, reason: "not_editable" };
  return { ok: true, lineCount };
}

/** Backpressure input for the intake routes' QueueFull valve. */
export async function countQueuedJobs(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(syncJobs)
    .where(eq(syncJobs.status, "queued"));
  return row?.n ?? 0;
}
