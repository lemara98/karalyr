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
  "auto_aligned",
  "user_submission",
  "ultrastar_import",
  "correction",
] as const;
export type Source = (typeof SOURCES)[number];

export const TIERS = ["auto_aligned", "community", "verified"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_RANK: Record<Tier, number> = {
  auto_aligned: 0,
  community: 1,
  verified: 2,
};

export const STATUSES = [
  "active",
  "pending_review",
  "rejected",
  "reverted",
  // Removed on a rights complaint. Terminal and distinct from "rejected":
  // rejected is a quality call an admin can reverse, taken_down is a legal
  // one. The row survives for the audit trail but its payload is purged -
  // see lib/takedown.ts. Never rankable (lib/ranking.ts filters on "active").
  "taken_down",
] as const;
export type RevisionStatus = (typeof STATUSES)[number];

export const SIGNAL_TYPES = [
  "explicit_up",
  "explicit_down",
  "offset_correction",
  "clean_playthrough",
  // Flags that the lyrics *content* is wrong (wrong/missing words, wrong song)
  // - distinct from offset_correction, which is about timing. Carries `reason`
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
    // ISO 639-1 language of the lyrics, denormalized from the best revision's
    // payload.meta.language whenever the best revision is recomputed. Null =
    // unknown/legacy. Powers the library language filter and og:locale.
    language: text("language"),
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

// Where a chord chart may come from. Deliberately NOT the lyric SOURCES list,
// and deliberately without any third-party member: charts fetched from
// external services (e.g. Songle) are non-redistributable, and keeping such a
// value unrepresentable in the schema is the firewall — a mistaken upload
// fails zod validation instead of relying on policy. v1 has exactly one
// producer, the worker's own analysis of audio the operator supplied.
export const CHORD_SOURCES = ["auto_detected"] as const;
export type ChordSource = (typeof CHORD_SOURCES)[number];

/**
 * Machine-detected chord charts, one payload per analysis run.
 *
 * A separate table rather than a field on revisions: revisions are immutable
 * LYRIC snapshots — community corrections, offset promotion (applyOffset) and
 * ranking all assume that — and a chart must survive lyric edits untouched.
 * Multi-row and append-only like revisions (a re-analysis with a better model
 * is an append, not an overwrite; takedown tombstones stay meaningful); the
 * serving query is simply "newest active wins" (getActiveChordChart), so no
 * materialized best-id is needed while there is one chart per track in
 * practice.
 *
 * Charts are timed against a specific recording; `derived_from_video_key`
 * records which one produced the timings (a track can have several videos
 * with different intros).
 */
export const chordCharts = sqliteTable(
  "chord_charts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id),
    source: text("source", { enum: CHORD_SOURCES }).notNull(),
    tier: text("tier", { enum: TIERS }).notNull(),
    status: text("status", { enum: STATUSES }).notNull().default("active"),
    payload: text("payload").notNull(),
    submitterFingerprint: text("submitter_fingerprint").notNull(),
    derivedFromVideoKey: text("derived_from_video_key"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("chord_charts_track_status_idx").on(t.trackId, t.status, t.createdAt)]
);

// External video → track mapping ("yt:<videoId>" keys, see lib/video-key.ts).
// Lets clients resolve lyrics by the video they are literally watching - an
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
  // any particular way of producing it, and no worker can see it - every
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
// A row is a *request*, not a work order - it records song identity, the plain
// lyrics an aligner would need, and (via syncJobVotes) who asked. Every public
// intake lands as "wanted"; only an admin promotes one to "queued", which is
// the only status the pull worker can claim. That split is deliberate: it
// keeps the public path from ever triggering a fetch, and lets a want be
// fulfilled any way at all - a local aligner run, the pull worker, or an
// upload.
export const syncJobs = sqliteTable(
  "sync_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: SYNC_JOB_SOURCES }).notNull(),
    status: text("status", { enum: SYNC_JOB_STATUSES }).notNull(),
    // Dedup identity: normalized "<artist>|<track>" (see lib/song-key.ts).
    // Not the video key - the same song arrives as a video, a re-upload, a
    // Spotify track, or with no link at all, and those must collapse to one
    // want. Always computed server-side.
    songKey: text("song_key").notNull(),
    // Display source: the best link anyone has offered for this song, re-picked
    // with pickPreferredVideoKey() as new ones arrive (an embeddable yt: beats
    // sp:). Nullable - a want needs only an artist and a title. Every source
    // ever supplied is kept per-requester on syncJobVotes.
    videoKey: text("video_key"),
    videoUrl: text("video_url"),
    artistName: text("artist_name").notNull(),
    trackName: text("track_name").notNull(),
    albumName: text("album_name"),
    // Nullable: yt-dlp metadata backfills it at complete time if missing.
    durationSeconds: real("duration_seconds"),
    // ISO 639-1 lyrics language (hi, vi, zh, …). Explicit intake hint or
    // Unicode-block sniff of the lyrics (lib/lang-detect.ts); null = Latin
    // catalog default. Passed to the aligner as --language.
    language: text("language"),
    // LRC/word tags already stripped at intake - stored exactly as the
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
    // At most one live request per song - the race-safe backstop behind the
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
// offered - with dedup on song identity, this is the only place the second and
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

// Discussion on a queue candidate (a sync_jobs row). Same author model as
// lyric_comments: shared Supabase accounts, display name snapshotted at post
// time so later renames don't rewrite history. Comments are allowed on any
// job status - talking about a rejected or finished request is legitimate.
export const syncJobComments = sqliteTable(
  "sync_job_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => syncJobs.id),
    body: text("body").notNull(),
    // Shared Supabase account id (same project as karafilt.com).
    authorUserId: text("author_user_id").notNull(),
    authorName: text("author_name"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("sync_job_comments_job_idx").on(t.jobId, t.createdAt),
    index("sync_job_comments_author_idx").on(t.authorUserId),
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

export const TAKEDOWN_STATUSES = [
  // Logged, nothing removed yet.
  "received",
  // Content removed. The normal outcome.
  "actioned",
  // Declined - not a rights complaint, or the claimant could not say what
  // work they hold. Declining is recorded rather than silent, because the
  // record of *why* is the point of keeping notices at all.
  "declined",
  "withdrawn",
] as const;
export type TakedownStatus = (typeof TAKEDOWN_STATUSES)[number];

/**
 * Rights complaints, and what was done about them.
 *
 * Karalyr serves lyric text, which is a copyrighted work separate from any
 * recording (see the README's legal posture). The defensible position for a
 * site built on user contributions is to host what contributors submit, act
 * promptly when a rightsholder objects, and be able to show both - so every
 * notice lands here whether or not it was actioned, and every takedown points
 * back at the notice that caused it.
 *
 * Deliberately not tied to a user account: a rightsholder must be able to
 * complain without signing up for anything.
 */
export const takedownNotices = sqliteTable(
  "takedown_notices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    status: text("status", { enum: TAKEDOWN_STATUSES }).notNull().default("received"),
    // Who is complaining, and on whose behalf. Free text: an agent acting for
    // a publisher is as valid as the writer themselves.
    claimantName: text("claimant_name").notNull(),
    claimantEmail: text("claimant_email").notNull(),
    claimantOrg: text("claimant_org"),
    /** Their relationship to the work ("rights owner", "authorised agent"…). */
    claimantRole: text("claimant_role").notNull(),
    /** The work being claimed, in the claimant's own words. */
    workDescription: text("work_description").notNull(),
    /** What on Karalyr they say infringes it - URLs, track ids, free text. */
    complainedOf: text("complained_of").notNull(),
    /** Track the notice resolved to, when it resolved to one. */
    trackId: integer("track_id").references(() => tracks.id),
    /** Revision ids actually removed, JSON array. Empty until actioned. */
    removedRevisionIds: text("removed_revision_ids").notNull().default("[]"),
    /** Admin's note: what was done, or why it was declined. */
    resolution: text("resolution"),
    /** Admin account that actioned it - accountability, same as moderation. */
    actionedBy: text("actioned_by"),
    actionedAt: integer("actioned_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("takedown_notices_status_idx").on(t.status, t.createdAt)]
);

/**
 * The repeat-infringer policy, in table form.
 *
 * Hosting protections (DMCA §512 in the US, the DSA's hosting exemption in
 * the EU) are conditioned on actually terminating people who keep uploading
 * other people's work. A policy nobody can enforce is not a policy, so the
 * block is checked on the publish path rather than left to intent.
 *
 * Keyed on the submitter fingerprint because that is the only identity a
 * revision carries - Karalyr takes contributions without accounts. It is a
 * weak identifier and blocking is therefore easy to evade; that is accepted.
 * The obligation is to act on what you can see, not to be unevadable.
 */
export const blockedSubmitters = sqliteTable(
  "blocked_submitters",
  {
    fingerprint: text("fingerprint").primaryKey(),
    /** Why, in the admin's words. Shown to nobody but the audit trail. */
    reason: text("reason").notNull(),
    /** Strike count at block time, for showing the policy was followed. */
    strikes: integer("strikes").notNull().default(0),
    blockedBy: text("blocked_by"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("blocked_submitters_created_idx").on(t.createdAt)]
);

export type Track = typeof tracks.$inferSelect;
export type Revision = typeof revisions.$inferSelect;
export type ChordChartRow = typeof chordCharts.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type TrackVideo = typeof trackVideos.$inferSelect;
export type LyricComment = typeof lyricComments.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
export type SyncJobVote = typeof syncJobVotes.$inferSelect;
export type SyncJobComment = typeof syncJobComments.$inferSelect;
export type TakedownNotice = typeof takedownNotices.$inferSelect;
export type BlockedSubmitter = typeof blockedSubmitters.$inferSelect;
