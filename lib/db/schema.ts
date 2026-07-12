import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
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
    fingerprint: text("fingerprint").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("signals_revision_type_idx").on(t.revisionId, t.type)]
);

export type Track = typeof tracks.$inferSelect;
export type Revision = typeof revisions.$inferSelect;
export type Signal = typeof signals.$inferSelect;
