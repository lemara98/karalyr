import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { CLEANUP_SUBMITTER, cleanupLrclibImports } from "@/lib/cleanup-lrclib";
import {
  lyricComments,
  revisions,
  signals,
  syncJobs,
  syncJobVotes,
  tracks,
  trackVideos,
} from "@/lib/db/schema";
import { makeComment, makeDb, makeRevision, makeSignal, makeTrack, samplePayload } from "./helpers";

/** Line-level payload with enough lines to clear the queue's ≥4-line gate. */
function lineLevelPayload(lineCount = 5): string {
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    start_ms: 4000 + i * 4000,
    end_ms: 7600 + i * 4000,
    singer: null,
    text: `Test line number ${i + 1}`,
  }));
  const p = samplePayload();
  return JSON.stringify({
    ...p,
    lines,
    meta: { ...p.meta, has_word_timing: false },
  });
}

/** A retired-era LRCLIB import revision (values no longer in the TS enums). */
async function makeLrclibRevision(db: Db, trackId: number, overrides: { payload?: string } = {}) {
  return makeRevision(db, trackId, {
    source: "lrclib_import" as never,
    tier: "imported" as never,
    payload: overrides.payload ?? lineLevelPayload(),
  });
}

async function linkVideo(db: Db, trackId: number, videoKey = "yt:dQw4w9WgXcQ") {
  await db.insert(trackVideos).values({ videoKey, trackId, createdAt: Date.now() });
}

describe("cleanupLrclibImports", () => {
  it("converts an lrclib-only track with a video into a wanted request, then deletes it", async () => {
    const db = await makeDb();
    const track = await makeTrack(db, { artistName: "Conv Artist", trackName: "Conv Song" });
    const rev = await makeLrclibRevision(db, track.id);
    await db.update(tracks).set({ bestRevisionId: rev.id }).where(eq(tracks.id, track.id));
    await linkVideo(db, track.id);

    const summary = await cleanupLrclibImports(db, { dryRun: false });
    expect(summary.jobsCreated).toBe(1);
    expect(summary.tracksDeleted).toBe(1);
    expect(summary.deletedNoVideo).toBe(0);

    const [job] = await db.select().from(syncJobs);
    expect(job.status).toBe("wanted");
    expect(job.videoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(job.submitterUserId).toBe(CLEANUP_SUBMITTER);
    expect(job.plainLyrics).toContain("Test line number 1");
    expect(await db.select().from(syncJobVotes)).toHaveLength(1);

    expect(await db.select().from(tracks)).toHaveLength(0);
    expect(await db.select().from(revisions)).toHaveLength(0);
    expect(await db.select().from(trackVideos)).toHaveLength(0);
  });

  it("deletes an lrclib-only track without a video outright — no request", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await makeLrclibRevision(db, track.id);

    const summary = await cleanupLrclibImports(db, { dryRun: false });
    expect(summary.tracksDeleted).toBe(1);
    expect(summary.deletedNoVideo).toBe(1);
    expect(summary.jobsCreated).toBe(0);
    expect(await db.select().from(syncJobs)).toHaveLength(0);
    expect(await db.select().from(tracks)).toHaveLength(0);
  });

  it("deletes without a request when the lyrics are too short for the queue", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const p = samplePayload();
    const shortPayload = JSON.stringify({
      ...p,
      lines: p.lines.slice(0, 1).map(({ words: _w, ...line }) => line),
      meta: { ...p.meta, has_word_timing: false },
    });
    await makeLrclibRevision(db, track.id, { payload: shortPayload });
    await linkVideo(db, track.id);

    const summary = await cleanupLrclibImports(db, { dryRun: false });
    expect(summary.badLyrics).toBe(1);
    expect(summary.jobsCreated).toBe(0);
    expect(await db.select().from(syncJobs)).toHaveLength(0);
    expect(await db.select().from(tracks)).toHaveLength(0);
  });

  it("keeps a track that also has a word-synced revision and repoints best", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const lrclib = await makeLrclibRevision(db, track.id);
    const community = await makeRevision(db, track.id);
    await db.update(tracks).set({ bestRevisionId: lrclib.id }).where(eq(tracks.id, track.id));
    await linkVideo(db, track.id);

    const summary = await cleanupLrclibImports(db, { dryRun: false });
    expect(summary.alreadySynced).toBe(1);
    expect(summary.jobsCreated).toBe(0);
    expect(summary.tracksKept).toBe(1);

    const [row] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(row.bestRevisionId).toBe(community.id);
    const revs = await db.select().from(revisions);
    expect(revs.map((r) => r.id)).toEqual([community.id]);
  });

  it("keeps a line-level survivor, nulls best, unchains corrections, and files a request", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const lrclib = await makeLrclibRevision(db, track.id);
    const lineCommunity = await makeRevision(db, track.id, {
      payload: lineLevelPayload(),
      parentRevisionId: lrclib.id,
    });
    await db.update(tracks).set({ bestRevisionId: lrclib.id }).where(eq(tracks.id, track.id));
    await linkVideo(db, track.id);

    const summary = await cleanupLrclibImports(db, { dryRun: false });
    expect(summary.jobsCreated).toBe(1);
    expect(summary.tracksKept).toBe(1);

    const [row] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(row.bestRevisionId).toBeNull();
    const [survivor] = await db.select().from(revisions);
    expect(survivor.id).toBe(lineCommunity.id);
    expect(survivor.parentRevisionId).toBeNull();
  });

  it("cascades signals and comments of the deleted revision, keeps the survivor's", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const lrclib = await makeLrclibRevision(db, track.id);
    const community = await makeRevision(db, track.id);
    await makeSignal(db, lrclib.id, { fingerprint: "fp-old" });
    await makeComment(db, track.id, lrclib.id);
    const kept = await makeComment(db, track.id, community.id);

    await cleanupLrclibImports(db, { dryRun: false });
    expect(await db.select().from(signals)).toHaveLength(0);
    const comments = await db.select().from(lyricComments);
    expect(comments.map((c) => c.id)).toEqual([kept.id]);
  });

  it("dedupes two lrclib tracks with the same song into one request plus a vote", async () => {
    const db = await makeDb();
    const a = await makeTrack(db, { artistName: "Same", trackName: "Song", durationSeconds: 180 });
    const b = await makeTrack(db, { artistName: "Same", trackName: "Song", durationSeconds: 200 });
    await makeLrclibRevision(db, a.id);
    await makeLrclibRevision(db, b.id);
    await linkVideo(db, a.id, "yt:aaaaaaaaaaa");
    await linkVideo(db, b.id, "yt:bbbbbbbbbbb");

    const summary = await cleanupLrclibImports(db, { dryRun: false });
    expect(summary.jobsCreated).toBe(1);
    expect(summary.votesRecorded).toBe(1);
    expect(await db.select().from(syncJobs)).toHaveLength(1);
    expect(await db.select().from(tracks)).toHaveLength(0);
  });

  it("dry-run writes nothing and reports the plan", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeLrclibRevision(db, track.id);
    await db.update(tracks).set({ bestRevisionId: rev.id }).where(eq(tracks.id, track.id));
    await linkVideo(db, track.id);
    await makeSignal(db, rev.id);

    const summary = await cleanupLrclibImports(db, { dryRun: true });
    expect(summary.actions.length).toBeGreaterThan(0);
    expect(await db.select().from(tracks)).toHaveLength(1);
    expect(await db.select().from(revisions)).toHaveLength(1);
    expect(await db.select().from(signals)).toHaveLength(1);
    expect(await db.select().from(syncJobs)).toHaveLength(0);
    expect(await db.select().from(trackVideos)).toHaveLength(1);
  });

  it("also clears line_observations when the legacy table still exists", async () => {
    const db = await makeDb();
    // The test DB is post-drop (migration 0010); recreate the pre-migration
    // state the prod run may execute under.
    await db.run(sql`
      CREATE TABLE line_observations (
        id integer PRIMARY KEY AUTOINCREMENT,
        track_id integer NOT NULL,
        line_start_ms integer NOT NULL,
        line_text text NOT NULL,
        words_json text NOT NULL,
        confidence real NOT NULL,
        fingerprint text NOT NULL,
        created_at integer NOT NULL
      )
    `);
    const track = await makeTrack(db);
    await makeLrclibRevision(db, track.id);
    await db.run(sql`
      INSERT INTO line_observations
        (track_id, line_start_ms, line_text, words_json, confidence, fingerprint, created_at)
      VALUES (${track.id}, 1000, 'x', '[]', 0.9, 'fp', ${Date.now()})
    `);

    const summary = await cleanupLrclibImports(db, { dryRun: false });
    expect(summary.tracksDeleted).toBe(1);
    const rows = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM line_observations`);
    expect(rows[0].n).toBe(0);
  });
});
