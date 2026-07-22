CREATE TABLE `kv_entries` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kv_entries_expires_idx` ON `kv_entries` (`expires_at`);