CREATE TABLE `blocked_submitters` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`strikes` integer DEFAULT 0 NOT NULL,
	`blocked_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `blocked_submitters_created_idx` ON `blocked_submitters` (`created_at`);--> statement-breakpoint
CREATE TABLE `takedown_notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`claimant_name` text NOT NULL,
	`claimant_email` text NOT NULL,
	`claimant_org` text,
	`claimant_role` text NOT NULL,
	`work_description` text NOT NULL,
	`complained_of` text NOT NULL,
	`track_id` integer,
	`removed_revision_ids` text DEFAULT '[]' NOT NULL,
	`resolution` text,
	`actioned_by` text,
	`actioned_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `takedown_notices_status_idx` ON `takedown_notices` (`status`,`created_at`);