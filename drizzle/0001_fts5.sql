CREATE VIRTUAL TABLE `tracks_fts` USING fts5(
  artist_name,
  track_name,
  album_name,
  content='tracks',
  content_rowid='id'
);
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_insert` AFTER INSERT ON `tracks` BEGIN
  INSERT INTO tracks_fts(rowid, artist_name, track_name, album_name)
  VALUES (new.id, new.artist_name, new.track_name, new.album_name);
END;
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_delete` AFTER DELETE ON `tracks` BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, artist_name, track_name, album_name)
  VALUES ('delete', old.id, old.artist_name, old.track_name, old.album_name);
END;
--> statement-breakpoint
CREATE TRIGGER `tracks_fts_update` AFTER UPDATE OF `artist_name`, `track_name`, `album_name` ON `tracks` BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, artist_name, track_name, album_name)
  VALUES ('delete', old.id, old.artist_name, old.track_name, old.album_name);
  INSERT INTO tracks_fts(rowid, artist_name, track_name, album_name)
  VALUES (new.id, new.artist_name, new.track_name, new.album_name);
END;
