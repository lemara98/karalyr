CREATE TABLE `lyric_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` integer NOT NULL,
	`revision_id` integer NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`quote` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text NOT NULL,
	`author_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lyric_comments_track_idx` ON `lyric_comments` (`track_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `lyric_comments_author_idx` ON `lyric_comments` (`author_user_id`);