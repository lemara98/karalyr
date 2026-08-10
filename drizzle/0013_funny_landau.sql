CREATE TABLE `chord_charts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` integer NOT NULL,
	`source` text NOT NULL,
	`tier` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`payload` text NOT NULL,
	`submitter_fingerprint` text NOT NULL,
	`derived_from_video_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chord_charts_track_status_idx` ON `chord_charts` (`track_id`,`status`,`created_at`);