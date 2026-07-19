CREATE TABLE `sync_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`video_key` text NOT NULL,
	`video_url` text NOT NULL,
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
CREATE INDEX `sync_jobs_status_idx` ON `sync_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `sync_jobs_user_idx` ON `sync_jobs` (`submitter_user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_jobs_active_video_uq` ON `sync_jobs` (`video_key`) WHERE status IN ('pending_approval', 'queued', 'processing');