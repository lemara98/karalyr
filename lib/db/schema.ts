import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const SOURCES = [
  "lrclib_import",
  "auto_aligned",
  "user_submission",
  "ultrastar_import",
  "correction",
] as const;
export type Source = (typeof SOURCES)[number];

export const TIERS = ["imported", "auto_aligned", "community", "verified"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_RANK: Record<Tier, number> = {
  imported: 0,
  auto_aligned: 1,
  community: 2,
  verified: 3,
};

export const STATUSES = ["active", "pending_review", "rejected", "reverted"] as const;
export type RevisionStatus = (typeof STATUSES)[number];

export const SIGNAL_TYPES = [
  "explicit_up",
  "explicit_down",
  "offset_correction",
  "clean_playthrough",
  // Flags that the lyrics *content* is wrong (wrong/missing words, wrong song)
  // — distinct from offset_correction, which is about timing. Carries `reason`
  // + optional `note`; counts as a negative in ranking/promotion.
  "content_report",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const tracks = sqliteTable(
  "tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    artistName: text("artist_name").notNull(),
    trackName: text("track_name").notNull(),
    albumName: text("album_name"),
    durationSeconds: real("duration_seconds").notNull(),
    bestRevisionId: integer("best_revision_id"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("tracks_artist_track_idx").on(t.artistName, t.trackName)]
);

export const revisions = sqliteTable(
  "revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id),
    source: text("source", { enum: SOURCES }).notNull(),
    tier: text("tier", { enum: TIERS }).notNull(),
    payload: text("payload").notNull(),
    parentRevisionId: integer("parent_revision_id"),
    submitterFingerprint: text("submitter_fingerprint").notNull(),
    status: text("status", { enum: STATUSES }).notNull().default("active"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    // When Rule A last promoted this revision; positive signals older than
    // this don't count toward the next promotion.
    promotedAt: integer("promoted_at"),
  },
  (t) => [index("revisions_track_status_idx").on(t.trackId, t.status)]
);

export const signals = sqliteTable(
  "signals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    revisionId: integer("revision_id")
      .notNull()
      .references(() => revisions.id),
    type: text("type", { enum: SIGNAL_TYPES }).notNull(),
    value: integer("value"),
    // content_report only: the report reason (see lib/reports.ts) and an
    // optional free-text note. Null for every timing/vote signal.
    reason: text("reason"),
    note: text("note"),
    fingerprint: text("fingerprint").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("signals_revision_type_idx").on(t.revisionId, t.type)]
);

// Per-line word-timing observations from listen-along clients (the Karafilt
// extension aligns lines while users play songs and submits fragments here).
// Aggregated into auto_aligned revisions by lib/stitch.ts once coverage is
// good enough — see /api/observe.
export const lineObservations = sqliteTable(
  "line_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id),
    // Anchor: the line's start time in the base line-level revision.
    lineStartMs: integer("line_start_ms").notNull(),
    lineText: text("line_text").notNull(),
    // JSON array of {text, start_ms, end_ms}
    wordsJson: text("words_json").notNull(),
    confidence: real("confidence").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("line_observations_track_idx").on(t.trackId, t.lineStartMs)]
);

// External video → track mapping ("yt:<videoId>" keys, see lib/video-key.ts).
// Lets clients resolve lyrics by the video they are literally watching — an
// exact lookup immune to title parsing. One video points at one track; a
// track may have many videos (official video, audio upload, re-uploads).
export const trackVideos = sqliteTable(
  "track_videos",
  {
    videoKey: text("video_key").primaryKey(),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("track_videos_track_idx").on(t.trackId)]
);

// Genius-style comments anchored to whole-line ranges of a track's lyrics.
// Indices are 0-based inclusive into the payload.lines of `revision_id` (the
// best revision at post time); `quote` is a server-side snapshot of those
// lines so the comment stays meaningful if the lyrics are later corrected.
// Authors are shared Supabase accounts with karafilt.com.
export const lyricComments = sqliteTable(
  "lyric_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id),
    revisionId: integer("revision_id")
      .notNull()
      .references(() => revisions.id),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    quote: text("quote").notNull(),
    body: text("body").notNull(),
    authorUserId: text("author_user_id").notNull(),
    authorName: text("author_name"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("lyric_comments_track_idx").on(t.trackId, t.createdAt),
    index("lyric_comments_author_idx").on(t.authorUserId),
  ]
);

export const SYNC_JOB_SOURCES = ["extension", "website"] as const;
export type SyncJobSource = (typeof SYNC_JOB_SOURCES)[number];

export const SYNC_JOB_STATUSES = [
  // Demand only: people want this song word-synced. Carries no commitment to
  // any particular way of producing it, and no worker can see it — every
  // public intake lands here.
  "wanted",
  "pending_approval",
  "queued",
  "processing",
  "done",
  "failed",
  "rejected",
  "cancelled",
] as const;
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number];

// Statuses that occupy the one live-slot per song (enforced by the partial
// unique index below), so a second request votes instead of inserting.
export const SYNC_JOB_ACTIVE_STATUSES = [
  "wanted",
  "pending_approval",
  "queued",
  "processing",
] as const satisfies readonly SyncJobStatus[];

// The word-sync demand queue: songs people want word-timed lyrics for.
//
// A row is a *request*, not a work order — it records song identity, the plain
// lyrics an aligner would need, and (via syncJobVotes) who asked. Every public
// intake lands as "wanted"; only an admin promotes one to "queued", which is
// the only status the pull worker can claim. That split is deliberate: it
// keeps the public path from ever triggering a fetch, and lets a want be
// fulfilled any way at all — crowd listen-along alignment (lib/stitch.ts), a
// local aligner run, or an upload.
export const syncJobs = sqliteTable(
  "sync_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: SYNC_JOB_SOURCES }).notNull(),
    status: text("status", { enum: SYNC_JOB_STATUSES }).notNull(),
    // Dedup identity: normalized "<artist>|<track>" (see lib/song-key.ts).
    // Not the video key — the same song arrives as a video, a re-upload, a
    // Spotify track, or with no link at all, and those must collapse to one
    // want. Always computed server-side.
    songKey: text("song_key").notNull(),
    // Display source: the best link anyone has offered for this song, re-picked
    // with pickPreferredVideoKey() as new ones arrive (an embeddable yt: beats
    // sp:). Nullable — a want needs only an artist and a title. Every source
    // ever supplied is kept per-requester on syncJobVotes.
    videoKey: text("video_key"),
    videoUrl: text("video_url"),
    artistName: text("artist_name").notNull(),
    trackName: text("track_name").notNull(),
    albumName: text("album_name"),
    // Nullable: yt-dlp metadata backfills it at complete time if missing.
    durationSeconds: real("duration_seconds"),
    // LRC/word tags already stripped at intake — stored exactly as the
    // aligner will read it (see stripToPlainLines).
    plainLyrics: text("plain_lyrics").notNull(),
    // Shared Supabase account id (same project as karafilt.com), whichever
    // intake path the job came through.
    submitterUserId: text("submitter_user_id").notNull(),
    submitterName: text("submitter_name"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(2),
    claimedBy: text("claimed_by"),
    leaseExpiresAt: integer("lease_expires_at"),
    // Retry backoff gate: claim skips queued rows until this ms-epoch passes.
    nextAttemptAt: integer("next_attempt_at"),
    lastError: text("last_error"),
    rejectionReason: text("rejection_reason"),
    resultTrackId: integer("result_track_id").references(() => tracks.id),
    resultRevisionId: integer("result_revision_id").references(() => revisions.id),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("sync_jobs_status_idx").on(t.status, t.createdAt),
    index("sync_jobs_user_idx").on(t.submitterUserId, t.createdAt),
    // At most one live request per song — the race-safe backstop behind the
    // read-then-insert dedup in lib/sync-queue/core.ts. Keyed on song_key, not
    // video_key: video_key is nullable and SQLite treats NULLs as distinct in
    // a unique index, so link-less wants would never dedup.
    uniqueIndex("sync_jobs_active_song_uq")
      .on(t.songKey)
      .where(sql`status IN ('wanted', 'pending_approval', 'queued', 'processing')`),
  ]
);

// One row per person per want. Demand is counted in distinct voters, the same
// way ranking counts distinct signal fingerprints, so nobody can inflate a
// song by asking twice. Each vote also keeps the source *that* requester
// offered — with dedup on song identity, this is the only place the second and
// third link for a song survive, and it's what makes a want traceable back to
// somewhere the song can actually be heard.
export const syncJobVotes = sqliteTable(
  "sync_job_votes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => syncJobs.id),
    // Shared Supabase account id (same project as karafilt.com).
    userId: text("user_id").notNull(),
    videoKey: text("video_key"),
    videoUrl: text("video_url"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("sync_job_votes_job_user_uq").on(t.jobId, t.userId),
    index("sync_job_votes_job_idx").on(t.jobId, t.createdAt),
  ]
);

// Backing store for the rate limiters and the proof-of-work replay guard
// (see lib/stores/kv.ts). These live in the database rather than in process
// memory because both are only meaningful when every instance shares them:
// per-process counters multiply the effective limit by the number of
// instances, and a per-process replay guard lets a solved PoW challenge be
// replayed against any instance that has not seen it.
//
// Rows are disposable. Losing this table costs nothing but a reset window.
export const kvEntries = sqliteTable(
  "kv_entries",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    /** ms epoch. Reads treat a past value as absent; a sweep deletes them. */
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("kv_entries_expires_idx").on(t.expiresAt)]
);

export type Track = typeof tracks.$inferSelect;
export type Revision = typeof revisions.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type LineObservation = typeof lineObservations.$inferSelect;
export type TrackVideo = typeof trackVideos.$inferSelect;
export type LyricComment = typeof lyricComments.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
export type SyncJobVote = typeof syncJobVotes.$inferSelect;
