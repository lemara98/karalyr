ALTER TABLE `sync_jobs` ADD `language` text;--> statement-breakpoint
ALTER TABLE `tracks` ADD `language` text;--> statement-breakpoint
UPDATE `tracks` SET `language` = (
  SELECT json_extract(r.payload, '$.meta.language')
  FROM `revisions` r WHERE r.id = `tracks`.`best_revision_id`
) WHERE `best_revision_id` IS NOT NULL;