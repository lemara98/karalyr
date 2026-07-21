CREATE TABLE `sync_job_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`video_key` text,
	`video_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `sync_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_job_votes_job_user_uq` ON `sync_job_votes` (`job_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `sync_job_votes_job_idx` ON `sync_job_votes` (`job_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`song_key` text NOT NULL,
	`video_key` text,
	`video_url` text,
	`artist_name` text NOT NULL,
	`track_name` text NOT NULL,
	`album_name` text,
	`duration_seconds` real,
	`plain_lyrics` text NOT NULL,
	`submitter_user_id` text NOT NULL,
	`submitter_name` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 2 NOT NULL,
	`claimed_by` text,
	`lease_expires_at` integer,
	`next_attempt_at` integer,
	`last_error` text,
	`rejection_reason` text,
	`result_track_id` integer,
	`result_revision_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`result_track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`result_revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- HAND-EDITED: drizzle-kit emitted `SELECT ..., "song_key", ... FROM sync_jobs`,
-- but song_key is the column being ADDED — it does not exist on the old table,
-- so the statement fails at prepare time whether or not any rows exist.
--
-- Backfilled instead with a SQL approximation of lib/song-key.ts. It lowercases
-- and trims but cannot fold diacritics or strip upload noise, so a pre-existing
-- row may not dedup against a key computed by the app. That is acceptable only
-- because this table was introduced one migration ago (0006) and has never
-- carried data; if you are restoring an environment that does, recompute
-- song_key with songKey() from lib/song-key.ts after migrating.
INSERT INTO `__new_sync_jobs`("id", "source", "status", "song_key", "video_key", "video_url", "artist_name", "track_name", "album_name", "duration_seconds", "plain_lyrics", "submitter_user_id", "submitter_name", "attempts", "max_attempts", "claimed_by", "lease_expires_at", "next_attempt_at", "last_error", "rejection_reason", "result_track_id", "result_revision_id", "created_at", "updated_at") SELECT "id", "source", "status", lower(trim("artist_name")) || '|' || lower(trim("track_name")), "video_key", "video_url", "artist_name", "track_name", "album_name", "duration_seconds", "plain_lyrics", "submitter_user_id", "submitter_name", "attempts", "max_attempts", "claimed_by", "lease_expires_at", "next_attempt_at", "last_error", "rejection_reason", "result_track_id", "result_revision_id", "created_at", "updated_at" FROM `sync_jobs`;--> statement-breakpoint
DROP TABLE `sync_jobs`;--> statement-breakpoint
ALTER TABLE `__new_sync_jobs` RENAME TO `sync_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sync_jobs_status_idx` ON `sync_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `sync_jobs_user_idx` ON `sync_jobs` (`submitter_user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_jobs_active_song_uq` ON `sync_jobs` (`song_key`) WHERE status IN ('wanted', 'pending_approval', 'queued', 'processing');