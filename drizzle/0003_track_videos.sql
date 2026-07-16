CREATE TABLE `track_videos` (
	`video_key` text PRIMARY KEY NOT NULL,
	`track_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `track_videos_track_idx` ON `track_videos` (`track_id`);