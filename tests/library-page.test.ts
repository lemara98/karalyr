import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { listSyncedTracksPage } from "@/lib/db/queries";
import { tracks } from "@/lib/db/schema";
import { makeDb, makeRevision, makeTrack } from "./helpers";

/** Track with lyrics: a revision promoted to best_revision_id. */
async function makeLyricTrack(db: Db, trackName: string) {
  const track = await makeTrack(db, { trackName });
  const rev = await makeRevision(db, track.id);
  await db.update(tracks).set({ bestRevisionId: rev.id }).where(eq(tracks.id, track.id));
  return { track, rev };
}

/** Walk every page the way the browser does, following nextCursor. */
async function readAll(db: Db, limit: number) {
  const names: string[] = [];
  let cursor: number | null = null;
  let pages = 0;
  do {
    const page: Awaited<ReturnType<typeof listSyncedTracksPage>> = await listSyncedTracksPage(db, {
      cursor,
      limit,
    });
    names.push(...page.items.map((t) => t.trackName));
    cursor = page.nextCursor;
    pages++;
  } while (cursor !== null && pages < 20);
  return { names, pages };
}

describe("listSyncedTracksPage", () => {
  it("only lists tracks that have karaoke lyrics", async () => {
    const db = await makeDb();
    await makeLyricTrack(db, "With lyrics");
    await makeTrack(db, { trackName: "No lyrics" });

    const page = await listSyncedTracksPage(db);
    expect(page.items.map((t) => t.trackName)).toEqual(["With lyrics"]);
    expect(page.items[0].bestTier).toBe("community");
    expect(page.items[0].bestHasWordTiming).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it("pages through every song, newest first, without gaps or repeats", async () => {
    const db = await makeDb();
    for (let i = 0; i < 7; i++) await makeLyricTrack(db, `Track ${i}`);

    const { names, pages } = await readAll(db, 3);
    expect(pages).toBe(3);
    expect(names).toEqual([
      "Track 6",
      "Track 5",
      "Track 4",
      "Track 3",
      "Track 2",
      "Track 1",
      "Track 0",
    ]);
  });

  it("reports a next cursor only while another page exists", async () => {
    const db = await makeDb();
    for (let i = 0; i < 4; i++) await makeLyricTrack(db, `Track ${i}`);

    const first = await listSyncedTracksPage(db, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1].id);

    const second = await listSyncedTracksPage(db, { cursor: first.nextCursor, limit: 2 });
    expect(second.items).toHaveLength(2);
    // Exactly four rows: the last page must not claim a fifth.
    expect(second.nextCursor).toBeNull();
  });

  it("keeps the reader's place when a song lands mid-scroll", async () => {
    const db = await makeDb();
    for (let i = 0; i < 4; i++) await makeLyricTrack(db, `Track ${i}`);

    const first = await listSyncedTracksPage(db, { limit: 2 });
    await makeLyricTrack(db, "Just published");

    const second = await listSyncedTracksPage(db, { cursor: first.nextCursor, limit: 2 });
    const seen = [...first.items, ...second.items].map((t) => t.trackName);
    // The newcomer sorts above the cursor, so it neither duplicates a row
    // already on screen nor pushes one off the next page.
    expect(seen).toEqual(["Track 3", "Track 2", "Track 1", "Track 0"]);
  });

  it("clamps an oversized limit", async () => {
    const db = await makeDb();
    for (let i = 0; i < 3; i++) await makeLyricTrack(db, `Track ${i}`);
    expect((await listSyncedTracksPage(db, { limit: 5000 })).items).toHaveLength(3);
  });
});
