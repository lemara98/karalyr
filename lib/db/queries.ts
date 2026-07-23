import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  lyricComments,
  revisions,
  syncJobComments,
  syncJobs,
  tracks,
  trackVideos,
  type LyricComment,
  type Revision,
  type Source,
  type SyncJob,
  type SyncJobComment,
  type Tier,
  type Track,
  type TrackVideo,
} from "./schema";
import type { LyricsPayload } from "../formats";
import { computeBestRevision } from "../ranking";

export const DURATION_TOLERANCE_S = 2;

export interface TrackQuery {
  artistName: string;
  trackName: string;
  albumName?: string | null;
  durationSeconds?: number | null;
}

/**
 * Exact lookup: case-insensitive artist + title (+ album when provided),
 * duration within +-2s. Multiple matches -> closest duration wins.
 */
export async function findTrack(db: Db, q: TrackQuery): Promise<Track | null> {
  const conditions = [
    sql`lower(${tracks.artistName}) = lower(${q.artistName})`,
    sql`lower(${tracks.trackName}) = lower(${q.trackName})`,
  ];
  if (q.albumName) {
    conditions.push(sql`lower(coalesce(${tracks.albumName}, '')) = lower(${q.albumName})`);
  }
  if (q.durationSeconds != null) {
    conditions.push(
      sql`abs(${tracks.durationSeconds} - ${q.durationSeconds}) <= ${DURATION_TOLERANCE_S}`
    );
  }

  const matches = await db
    .select()
    .from(tracks)
    .where(and(...conditions));
  if (matches.length === 0) return null;
  if (q.durationSeconds == null) return matches[0];
  return matches.reduce((best, t) =>
    Math.abs(t.durationSeconds - q.durationSeconds!) <
    Math.abs(best.durationSeconds - q.durationSeconds!)
      ? t
      : best
  );
}

/** Exact lookup by video key ("yt:<id>", see lib/video-key.ts). */
export async function findTrackByVideo(db: Db, videoKey: string): Promise<Track | null> {
  const [row] = await db
    .select({ track: tracks })
    .from(trackVideos)
    .innerJoin(tracks, eq(tracks.id, trackVideos.trackId))
    .where(eq(trackVideos.videoKey, videoKey));
  return row?.track ?? null;
}

/**
 * Map a video to a track. Last write wins on conflict so a re-import with
 * corrected metadata repoints the video instead of sticking to the old row.
 */
export async function linkTrackVideo(db: Db, trackId: number, videoKey: string): Promise<void> {
  await db
    .insert(trackVideos)
    .values({ videoKey, trackId, createdAt: Date.now() })
    .onConflictDoUpdate({ target: trackVideos.videoKey, set: { trackId } });
}

/** All videos linked to a track, oldest first (videoKey tiebreak for determinism). */
export async function listTrackVideos(db: Db, trackId: number): Promise<TrackVideo[]> {
  return db
    .select()
    .from(trackVideos)
    .where(eq(trackVideos.trackId, trackId))
    .orderBy(asc(trackVideos.createdAt), asc(trackVideos.videoKey));
}

export async function findOrCreateTrack(
  db: Db,
  q: TrackQuery & { durationSeconds: number }
): Promise<Track> {
  const existing = await findTrack(db, q);
  if (existing) return existing;
  const [created] = await db
    .insert(tracks)
    .values({
      artistName: q.artistName.trim(),
      trackName: q.trackName.trim(),
      albumName: q.albumName?.trim() || null,
      durationSeconds: q.durationSeconds,
      createdAt: Date.now(),
    })
    .returning();
  return created;
}

export interface NewRevisionInput {
  trackId: number;
  source: Source;
  tier: Tier;
  payload: LyricsPayload;
  parentRevisionId?: number | null;
  submitterFingerprint: string;
}

/**
 * Insert a revision, applying Rule C: if the track's current best revision
 * is verified, the newcomer enters pending_review instead of going live.
 * Recomputes best_revision_id afterwards.
 */
export async function insertRevision(db: Db, input: NewRevisionInput): Promise<Revision> {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, input.trackId));
  if (!track) throw new Error(`Track ${input.trackId} not found`);

  let status: Revision["status"] = "active";
  if (track.bestRevisionId !== null) {
    const [best] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, track.bestRevisionId));
    if (best?.tier === "verified") status = "pending_review";
  }

  const [created] = await db
    .insert(revisions)
    .values({
      trackId: input.trackId,
      source: input.source,
      tier: input.tier,
      payload: JSON.stringify(input.payload),
      parentRevisionId: input.parentRevisionId ?? null,
      submitterFingerprint: input.submitterFingerprint,
      status,
      createdAt: Date.now(),
    })
    .returning();

  await computeBestRevision(db, input.trackId);
  return created;
}

export interface SearchResult extends Track {
  bestTier: Tier | null;
  bestHasWordTiming: boolean;
}

/** FTS5 prefix search over artist/title/album, best matches first. */
export async function searchTracks(db: Db, query: string, limit = 25): Promise<SearchResult[]> {
  const terms = query
    .replace(/["'*()^]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(" ");
  if (terms === "") return [];

  const rows = await db.all<{
    id: number;
    artist_name: string;
    track_name: string;
    album_name: string | null;
    duration_seconds: number;
    best_revision_id: number | null;
    created_at: number;
    best_tier: Tier | null;
    best_has_words: number | null;
  }>(sql`
    SELECT t.*, r.tier AS best_tier,
      json_extract(r.payload, '$.meta.has_word_timing') AS best_has_words
    FROM tracks_fts f
    JOIN tracks t ON t.id = f.rowid
    LEFT JOIN revisions r ON r.id = t.best_revision_id
    WHERE tracks_fts MATCH ${terms}
    ORDER BY bm25(tracks_fts)
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    artistName: r.artist_name,
    trackName: r.track_name,
    albumName: r.album_name,
    durationSeconds: r.duration_seconds,
    bestRevisionId: r.best_revision_id,
    createdAt: r.created_at,
    bestTier: r.best_tier,
    bestHasWordTiming: r.best_has_words === 1,
  }));
}

/** Full revision history for a track, newest first. */
export async function listRevisions(db: Db, trackId: number): Promise<Revision[]> {
  return db
    .select()
    .from(revisions)
    .where(eq(revisions.trackId, trackId))
    .orderBy(desc(revisions.createdAt), desc(revisions.id));
}

export interface MostUsedTrack extends Track {
  bestTier: Tier | null;
  bestHasWordTiming: boolean;
  /** Distinct people who signaled, listen-alonged, or commented on the track. */
  singers: number;
}

/**
 * Tracks with karaoke lyrics, ranked by how much they are actually used —
 * derived from the usage data we already store rather than a play counter:
 * every vote/report signal, listen-along line observation, and lyric comment
 * counts its author once (distinct fingerprints / user ids; system
 * fingerprints excluded). Ties break by raw event volume, then newest track,
 * so a fresh library still renders a sensible list.
 */
export async function listMostUsedTracks(db: Db, limit = 8): Promise<MostUsedTrack[]> {
  const rows = await db.all<{
    id: number;
    artist_name: string;
    track_name: string;
    album_name: string | null;
    duration_seconds: number;
    best_revision_id: number | null;
    created_at: number;
    best_tier: Tier | null;
    best_has_words: number | null;
    singers: number;
  }>(sql`
    WITH usage_events AS (
      SELECT r.track_id AS track_id, s.fingerprint AS who
      FROM signals s
      JOIN revisions r ON r.id = s.revision_id
      UNION ALL
      SELECT o.track_id, o.fingerprint FROM line_observations o
      UNION ALL
      SELECT c.track_id, 'user:' || c.author_user_id FROM lyric_comments c
    )
    SELECT t.*, r.tier AS best_tier,
      json_extract(r.payload, '$.meta.has_word_timing') AS best_has_words,
      COUNT(DISTINCT u.who) AS singers,
      COUNT(u.who) AS events
    FROM tracks t
    JOIN revisions r ON r.id = t.best_revision_id
    LEFT JOIN usage_events u ON u.track_id = t.id AND u.who NOT LIKE 'system:%'
    GROUP BY t.id
    ORDER BY singers DESC, events DESC, t.created_at DESC, t.id DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    artistName: r.artist_name,
    trackName: r.track_name,
    albumName: r.album_name,
    durationSeconds: r.duration_seconds,
    bestRevisionId: r.best_revision_id,
    createdAt: r.created_at,
    bestTier: r.best_tier,
    bestHasWordTiming: r.best_has_words === 1,
    singers: r.singers,
  }));
}

export interface LibraryTrack extends Track {
  bestTier: Tier | null;
  bestHasWordTiming: boolean;
  /** Distinct people who signaled, listen-alonged, or commented on the track. */
  singers: number;
  /** Net rating on the best revision: ups + clean playthroughs − downs − reports. */
  score: number;
}

/**
 * The /library listing: every track with karaoke lyrics, the well-used and
 * well-rated ones first. Usage is the same distinct-people measure as
 * listMostUsedTracks; rating is the net vote balance on the track's best
 * revision. Tracks with neither stay in the list (ranked below, newest
 * first) so a young library still fills the page.
 */
export async function listLibraryTracks(db: Db, limit = 60): Promise<LibraryTrack[]> {
  const rows = await db.all<{
    id: number;
    artist_name: string;
    track_name: string;
    album_name: string | null;
    duration_seconds: number;
    best_revision_id: number | null;
    created_at: number;
    best_tier: Tier | null;
    best_has_words: number | null;
    singers: number;
    score: number;
  }>(sql`
    WITH usage_events AS (
      SELECT r.track_id AS track_id, s.fingerprint AS who
      FROM signals s
      JOIN revisions r ON r.id = s.revision_id
      UNION ALL
      SELECT o.track_id, o.fingerprint FROM line_observations o
      UNION ALL
      SELECT c.track_id, 'user:' || c.author_user_id FROM lyric_comments c
    ),
    votes AS (
      SELECT s.revision_id,
        SUM(CASE
          WHEN s.type IN ('explicit_up', 'clean_playthrough') THEN 1
          WHEN s.type IN ('explicit_down', 'content_report') THEN -1
          ELSE 0
        END) AS score
      FROM signals s
      WHERE s.fingerprint NOT LIKE 'system:%'
      GROUP BY s.revision_id
    )
    SELECT t.*, r.tier AS best_tier,
      json_extract(r.payload, '$.meta.has_word_timing') AS best_has_words,
      COUNT(DISTINCT u.who) AS singers,
      COALESCE(v.score, 0) AS score
    FROM tracks t
    JOIN revisions r ON r.id = t.best_revision_id
    LEFT JOIN usage_events u ON u.track_id = t.id AND u.who NOT LIKE 'system:%'
    LEFT JOIN votes v ON v.revision_id = r.id
    GROUP BY t.id
    ORDER BY (COUNT(DISTINCT u.who) > 0 OR COALESCE(v.score, 0) > 0) DESC,
      COALESCE(v.score, 0) DESC, COUNT(DISTINCT u.who) DESC,
      t.created_at DESC, t.id DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    artistName: r.artist_name,
    trackName: r.track_name,
    albumName: r.album_name,
    durationSeconds: r.duration_seconds,
    bestRevisionId: r.best_revision_id,
    createdAt: r.created_at,
    bestTier: r.best_tier,
    bestHasWordTiming: r.best_has_words === 1,
    singers: r.singers,
    score: r.score,
  }));
}

export interface NewestSyncedTrack extends Track {
  bestTier: Tier | null;
  bestHasWordTiming: boolean;
  /** When the track's current best revision was published. */
  syncedAt: number;
}

/** Tracks whose karaoke lyrics arrived most recently — the /library carousel. */
export async function listNewestSyncedTracks(db: Db, limit = 12): Promise<NewestSyncedTrack[]> {
  const rows = await db.all<{
    id: number;
    artist_name: string;
    track_name: string;
    album_name: string | null;
    duration_seconds: number;
    best_revision_id: number | null;
    created_at: number;
    best_tier: Tier | null;
    best_has_words: number | null;
    synced_at: number;
  }>(sql`
    SELECT t.*, r.tier AS best_tier, r.created_at AS synced_at,
      json_extract(r.payload, '$.meta.has_word_timing') AS best_has_words
    FROM tracks t
    JOIN revisions r ON r.id = t.best_revision_id
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    artistName: r.artist_name,
    trackName: r.track_name,
    albumName: r.album_name,
    durationSeconds: r.duration_seconds,
    bestRevisionId: r.best_revision_id,
    createdAt: r.created_at,
    bestTier: r.best_tier,
    bestHasWordTiming: r.best_has_words === 1,
    syncedAt: r.synced_at,
  }));
}

export interface NewLyricCommentInput {
  trackId: number;
  revisionId: number;
  startLine: number;
  endLine: number;
  quote: string;
  body: string;
  authorUserId: string;
  authorName: string | null;
}

export async function insertLyricComment(
  db: Db,
  input: NewLyricCommentInput
): Promise<LyricComment> {
  const [created] = await db
    .insert(lyricComments)
    .values({ ...input, createdAt: Date.now() })
    .returning();
  return created;
}

/** All comments on a track, oldest first. */
export async function listLyricComments(db: Db, trackId: number): Promise<LyricComment[]> {
  return db
    .select()
    .from(lyricComments)
    .where(eq(lyricComments.trackId, trackId))
    .orderBy(asc(lyricComments.createdAt), asc(lyricComments.id));
}

/** Newest comments across all tracks, joined with the track (admin view). */
export async function listRecentLyricComments(
  db: Db,
  limit = 100
): Promise<{ comment: LyricComment; track: Track }[]> {
  return db
    .select({ comment: lyricComments, track: tracks })
    .from(lyricComments)
    .innerJoin(tracks, eq(tracks.id, lyricComments.trackId))
    .orderBy(desc(lyricComments.createdAt), desc(lyricComments.id))
    .limit(limit);
}

/** Hard delete (admin moderation). Returns false when the id doesn't exist. */
export async function deleteLyricComment(db: Db, id: number): Promise<boolean> {
  const deleted = await db
    .delete(lyricComments)
    .where(eq(lyricComments.id, id))
    .returning({ id: lyricComments.id });
  return deleted.length > 0;
}

export interface NewSyncJobCommentInput {
  jobId: number;
  body: string;
  authorUserId: string;
  authorName: string | null;
}

export async function insertSyncJobComment(
  db: Db,
  input: NewSyncJobCommentInput
): Promise<SyncJobComment> {
  const [created] = await db
    .insert(syncJobComments)
    .values({ ...input, createdAt: Date.now() })
    .returning();
  return created;
}

/** All comments on a queue candidate, oldest first. */
export async function listSyncJobComments(db: Db, jobId: number): Promise<SyncJobComment[]> {
  return db
    .select()
    .from(syncJobComments)
    .where(eq(syncJobComments.jobId, jobId))
    .orderBy(asc(syncJobComments.createdAt), asc(syncJobComments.id));
}

/** Latest candidate comments across all jobs, for moderation. */
export async function listRecentSyncJobComments(
  db: Db,
  limit = 100
): Promise<{ comment: SyncJobComment; job: SyncJob }[]> {
  return db
    .select({ comment: syncJobComments, job: syncJobs })
    .from(syncJobComments)
    .innerJoin(syncJobs, eq(syncJobs.id, syncJobComments.jobId))
    .orderBy(desc(syncJobComments.createdAt), desc(syncJobComments.id))
    .limit(limit);
}

export async function deleteSyncJobComment(db: Db, id: number): Promise<boolean> {
  const deleted = await db
    .delete(syncJobComments)
    .where(eq(syncJobComments.id, id))
    .returning({ id: syncJobComments.id });
  return deleted.length > 0;
}

export interface WantedSong {
  jobId: number;
  artistName: string;
  trackName: string;
  albumName: string | null;
  /** Distinct people who asked for it. */
  voters: number;
  /** Best link anyone offered, for tracing the song back to where it plays. */
  videoUrl: string | null;
  videoKey: string | null;
  /** Set when the song is already in the library, just without word timing. */
  trackId: number | null;
  /** Opening of the submitted lyrics — a teaser, not the full text. */
  lyricsPreview: string | null;
  createdAt: number;
}

export interface WantedSearchResult {
  songs: WantedSong[];
  total: number;
  /** The page actually served — clamped into [1, ceil(total/perPage)]. */
  page: number;
  perPage: number;
}

/** Treat %, _ and \ literally inside a LIKE pattern (paired with ESCAPE '\'). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Search + paginate the open requests. Every term must match (AND), each
 * against any of artist, title, album, or the submitted lyrics text — people
 * often remember a line, not the title. LIKE is plenty: the queue is capped
 * at a few hundred rows, so this needs no FTS.
 *
 * Ranked by how many distinct people asked, oldest first on a tie so a
 * long-standing request isn't buried by a newer one with equal demand — a
 * fully deterministic order, which is what makes OFFSET paging stable.
 *
 * Songs that have since been word-synced are excluded defensively — closing
 * them is resolveWantedForTrack's job, but a request that arrived while a
 * revision was mid-flight shouldn't show up here in the meantime.
 */
export async function searchWantedSongs(
  db: Db,
  { q = "", page = 1, perPage = 20 }: { q?: string; page?: number; perPage?: number } = {}
): Promise<WantedSearchResult> {
  const terms = q.trim().slice(0, 200).split(/\s+/).filter(Boolean).slice(0, 8);

  const where = [
    sql`j.status IN ('wanted', 'pending_approval', 'queued', 'processing')`,
    sql`NOT EXISTS (
      SELECT 1 FROM track_videos tv
      JOIN revisions r ON r.track_id = tv.track_id
      WHERE tv.video_key = j.video_key
        AND r.status IN ('active', 'pending_review')
        AND json_extract(r.payload, '$.meta.has_word_timing') = 1
    )`,
    ...terms.map((term) => {
      const pat = `%${escapeLike(term)}%`;
      return sql`(j.artist_name LIKE ${pat} ESCAPE '\\'
        OR j.track_name LIKE ${pat} ESCAPE '\\'
        OR coalesce(j.album_name, '') LIKE ${pat} ESCAPE '\\'
        OR j.plain_lyrics LIKE ${pat} ESCAPE '\\')`;
    }),
  ];
  const whereSql = sql.join(where, sql` AND `);

  // Count first (no votes join needed — results are one row per job), then
  // clamp the page so out-of-range requests serve the last page, not a void.
  const [count] = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM sync_jobs j WHERE ${whereSql}`
  );
  const total = count?.n ?? 0;
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, Math.ceil(total / perPage)));

  const rows = await db.all<{
    job_id: number;
    artist_name: string;
    track_name: string;
    album_name: string | null;
    voters: number;
    video_url: string | null;
    video_key: string | null;
    track_id: number | null;
    lyrics_preview: string | null;
    created_at: number;
  }>(sql`
    SELECT j.id AS job_id, j.artist_name, j.track_name, j.album_name,
      j.video_url, j.video_key, j.created_at,
      substr(j.plain_lyrics, 1, 500) AS lyrics_preview,
      COUNT(DISTINCT v.user_id) AS voters,
      (SELECT tv.track_id FROM track_videos tv WHERE tv.video_key = j.video_key LIMIT 1) AS track_id
    FROM sync_jobs j
    LEFT JOIN sync_job_votes v ON v.job_id = j.id
    WHERE ${whereSql}
    GROUP BY j.id
    ORDER BY voters DESC, j.created_at ASC, j.id ASC
    LIMIT ${perPage} OFFSET ${(safePage - 1) * perPage}
  `);

  const songs = rows.map((r) => ({
    jobId: r.job_id,
    artistName: r.artist_name,
    trackName: r.track_name,
    albumName: r.album_name,
    voters: r.voters,
    videoUrl: r.video_url,
    videoKey: r.video_key,
    trackId: r.track_id,
    lyricsPreview: r.lyrics_preview?.trim() ? r.lyrics_preview : null,
    createdAt: r.created_at,
  }));

  return { songs, total, page: safePage, perPage };
}

/** The most-wanted songs — page 1 of the unfiltered search. */
export async function listMostWantedSongs(db: Db, limit = 10): Promise<WantedSong[]> {
  return (await searchWantedSongs(db, { perPage: limit })).songs;
}

export interface WantedSongDetail {
  job: SyncJob;
  /** Distinct people who asked for it. */
  voters: number;
  /** Every link anyone offered, newest first. */
  sources: { videoKey: string; videoUrl: string; createdAt: number }[];
  /** Track already in the library via the job's link (may lack word timing). */
  libraryTrackId: number | null;
}

/**
 * One queue candidate with everything its page shows. No status filter on
 * purpose: done and rejected requests keep their page (with the outcome),
 * only the listing hides them.
 */
export async function getWantedSongDetail(db: Db, jobId: number): Promise<WantedSongDetail | null> {
  const [job] = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId));
  if (!job) return null;

  const [voters, sources, videoRows] = await Promise.all([
    countJobVoters(db, jobId),
    listWantedSources(db, jobId),
    job.videoKey
      ? db
          .select({ trackId: trackVideos.trackId })
          .from(trackVideos)
          .where(eq(trackVideos.videoKey, job.videoKey))
      : Promise.resolve([]),
  ]);

  return { job, voters, sources, libraryTrackId: videoRows[0]?.trackId ?? null };
}

/** Distinct people who asked for one request. */
export async function countJobVoters(db: Db, jobId: number): Promise<number> {
  const [row] = await db.all<{ n: number }>(
    sql`SELECT COUNT(DISTINCT user_id) AS n FROM sync_job_votes WHERE job_id = ${jobId}`
  );
  return row?.n ?? 0;
}

/**
 * Every source anyone offered for one request, newest first. Dedup collapses on
 * song identity, so this is where the second and third link for a song live —
 * the operator picks which one to actually work from.
 */
export async function listWantedSources(
  db: Db,
  jobId: number
): Promise<{ videoKey: string; videoUrl: string; createdAt: number }[]> {
  const rows = await db.all<{ video_key: string; video_url: string; created_at: number }>(sql`
    SELECT video_key, video_url, created_at
    FROM sync_job_votes
    WHERE job_id = ${jobId} AND video_key IS NOT NULL AND video_url IS NOT NULL
    ORDER BY created_at DESC, id DESC
  `);
  return rows.map((r) => ({
    videoKey: r.video_key,
    videoUrl: r.video_url,
    createdAt: r.created_at,
  }));
}
