import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { listTrackVideos } from "./db/queries";
import {
  lyricComments,
  revisions,
  signals,
  syncJobs,
  tracks,
  trackVideos,
  type Revision,
} from "./db/schema";
import { payloadToPlainText, validatePayload } from "./formats";
import { computeBestRevision } from "./ranking";
import { enqueueSyncJob } from "./sync-queue/core";
import { parseVideoKey, pickPreferredVideoKey } from "./video-key";

/**
 * One-off cleanup for the retired LRCLIB lazy-import era: Karalyr is
 * word/syllable-synced only, so every `lrclib_import` revision (line-level)
 * gets deleted. Per the owner's call, a track is converted into a wanted-queue
 * request ONLY when a video URL is linked to it — the queue UI and the
 * alignment operator need a source to work from; without one the track is
 * deleted outright and comes back the day someone requests it properly.
 *
 * Dry-run limitation: without writing, the enqueue dedupe verdict (new job vs
 * vote vs AlreadySynced) can't be known — the action log says "would enqueue"
 * and the apply run reports what actually happened.
 *
 * Idempotent: a second run finds zero `lrclib_import` rows.
 */

export const CLEANUP_SUBMITTER = "system:lrclib-cleanup";

export interface CleanupSummary {
  tracksScanned: number;
  revisionsDeleted: number;
  tracksDeleted: number;
  tracksKept: number;
  jobsCreated: number;
  votesRecorded: number;
  alreadySynced: number;
  badLyrics: number;
  deletedNoVideo: number;
  actions: string[];
}

function videoUrlFromKey(key: string | null): string | null {
  const parsed = parseVideoKey(key);
  if (!parsed) return null;
  return parsed.platform === "youtube"
    ? `https://www.youtube.com/watch?v=${parsed.id}`
    : `https://open.spotify.com/track/${parsed.id}`;
}

export async function cleanupLrclibImports(
  db: Db,
  opts: { dryRun: boolean; now?: number }
): Promise<CleanupSummary> {
  const { dryRun } = opts;
  const now = opts.now ?? Date.now();
  const summary: CleanupSummary = {
    tracksScanned: 0,
    revisionsDeleted: 0,
    tracksDeleted: 0,
    tracksKept: 0,
    jobsCreated: 0,
    votesRecorded: 0,
    alreadySynced: 0,
    badLyrics: 0,
    deletedNoVideo: 0,
    actions: [],
  };
  const log = (msg: string) => summary.actions.push(msg);

  // The line_observations drop migration may or may not have run yet — the
  // script works either way.
  const obsTable = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'line_observations'`
  );
  const hasObsTable = obsTable.length > 0;

  // Raw predicate: "lrclib_import" is gone from the TS enum but may live in
  // the data until this very script removes it.
  const targets = (await db
    .select()
    .from(revisions)
    .where(sql`${revisions.source} = 'lrclib_import'`)) as Revision[];

  const byTrack = new Map<number, Revision[]>();
  for (const rev of targets) {
    const list = byTrack.get(rev.trackId) ?? [];
    list.push(rev);
    byTrack.set(rev.trackId, list);
  }

  for (const [trackId, lrclibRevs] of byTrack) {
    const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
    if (!track) continue;
    summary.tracksScanned++;

    const allRevs = (await db
      .select()
      .from(revisions)
      .where(eq(revisions.trackId, trackId))) as Revision[];
    const lrclibIds = new Set(lrclibRevs.map((r) => r.id));
    const survivors = allRevs.filter((r) => !lrclibIds.has(r.id));
    const label = `"${track.artistName} — ${track.trackName}" (track ${trackId})`;

    // Conversion first, while track_videos still exists. Owner's rule: only
    // songs with a linked video become wanted-queue requests.
    const videoUrl = videoUrlFromKey(
      pickPreferredVideoKey(await listTrackVideos(db, trackId))
    );
    if (videoUrl) {
      const newest = [...lrclibRevs].sort((a, b) => b.createdAt - a.createdAt)[0];
      let rawLyrics = "";
      try {
        rawLyrics = payloadToPlainText(validatePayload(JSON.parse(newest.payload)));
      } catch {
        // Unparseable payload: nothing to hand the queue, treat as no lyrics.
      }
      const lineCount = rawLyrics.split("\n").filter((l) => l.trim()).length;
      if (dryRun) {
        log(`${label}: would enqueue wanted request (${videoUrl}, ${lineCount} lyric lines)`);
      } else {
        const res = await enqueueSyncJob(
          db,
          {
            source: "website",
            videoUrl,
            artistName: track.artistName,
            trackName: track.trackName,
            albumName: track.albumName,
            durationSeconds: track.durationSeconds,
            rawLyrics,
            submitterUserId: CLEANUP_SUBMITTER,
          },
          now
        );
        if (res.ok) {
          if (res.voted) {
            summary.votesRecorded++;
            log(`${label}: live request already exists — recorded a vote (job ${res.job.id})`);
          } else {
            summary.jobsCreated++;
            log(`${label}: wanted request created (job ${res.job.id}, ${videoUrl})`);
          }
        } else if (res.code === "AlreadySynced") {
          summary.alreadySynced++;
          log(`${label}: already word-synced elsewhere — no request needed`);
        } else if (res.code === "BadLyrics") {
          summary.badLyrics++;
          log(`${label}: lyrics too short for the queue — deleting without a request`);
        } else {
          log(`${label}: enqueue rejected (${res.code}) — deleting without a request`);
        }
      }
    }

    // Delete each lrclib revision, children first (FKs are NO ACTION).
    for (const rev of lrclibRevs) {
      if (dryRun) {
        log(`${label}: would delete revision ${rev.id} (+signals/comments, unchain corrections)`);
      } else {
        await db.delete(signals).where(eq(signals.revisionId, rev.id));
        await db.delete(lyricComments).where(eq(lyricComments.revisionId, rev.id));
        await db
          .update(revisions)
          .set({ parentRevisionId: null })
          .where(eq(revisions.parentRevisionId, rev.id));
        await db
          .update(syncJobs)
          .set({ resultRevisionId: null })
          .where(eq(syncJobs.resultRevisionId, rev.id));
        await db.delete(revisions).where(eq(revisions.id, rev.id));
      }
      summary.revisionsDeleted++;
    }

    if (survivors.length === 0) {
      if (dryRun) {
        log(`${label}: would delete the track (no other revisions)`);
      } else {
        await db.delete(lyricComments).where(eq(lyricComments.trackId, trackId));
        if (hasObsTable) {
          await db.run(sql`DELETE FROM line_observations WHERE track_id = ${trackId}`);
        }
        await db.delete(trackVideos).where(eq(trackVideos.trackId, trackId));
        await db
          .update(syncJobs)
          .set({ resultTrackId: null })
          .where(eq(syncJobs.resultTrackId, trackId));
        // Plain DELETE so the tracks_fts triggers keep the index in sync.
        await db.delete(tracks).where(eq(tracks.id, trackId));
      }
      summary.tracksDeleted++;
      if (!videoUrl) summary.deletedNoVideo++;
    } else {
      if (dryRun) {
        log(`${label}: would keep the track (${survivors.length} other revisions) and recompute best`);
      } else {
        await computeBestRevision(db, trackId);
      }
      summary.tracksKept++;
    }
  }

  return summary;
}
