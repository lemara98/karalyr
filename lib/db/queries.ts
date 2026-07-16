import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  revisions,
  tracks,
  trackVideos,
  type Revision,
  type Source,
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
  }>(sql`
    SELECT t.*, r.tier AS best_tier
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
