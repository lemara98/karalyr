CREATE TABLE `sync_job_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text NOT NULL,
	`author_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `sync_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sync_job_comments_job_idx` ON `sync_job_comments` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sync_job_comments_author_idx` ON `sync_job_comments` (`author_user_id`);