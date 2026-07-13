CREATE TABLE `line_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` integer NOT NULL,
	`line_start_ms` integer NOT NULL,
	`line_text` text NOT NULL,
	`words_json` text NOT NULL,
	`confidence` real NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `line_observations_track_idx` ON `line_observations` (`track_id`,`line_start_ms`);