import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { listMostUsedTracks } from "@/lib/db/queries";
import { tracks } from "@/lib/db/schema";
import { makeComment, makeDb, makeRevision, makeSignal, makeTrack } from "./helpers";

/** Track with lyrics: a revision promoted to best_revision_id. */
async function makeLyricTrack(db: Db, trackName: string, createdAt = Date.now()) {
  const track = await makeTrack(db, { trackName, createdAt });
  const rev = await makeRevision(db, track.id);
  await db.update(tracks).set({ bestRevisionId: rev.id }).where(eq(tracks.id, track.id));
  return { track, rev };
}

describe("listMostUsedTracks", () => {
  it("only lists tracks that have karaoke lyrics", async () => {
    const db = await makeDb();
    await makeLyricTrack(db, "With lyrics");
    await makeTrack(db, { trackName: "No lyrics" });

    const rows = await listMostUsedTracks(db);
    expect(rows.map((r) => r.trackName)).toEqual(["With lyrics"]);
    expect(rows[0].bestTier).toBe("community");
    expect(rows[0].bestHasWordTiming).toBe(true);
  });

  it("ranks by distinct users, not raw event count", async () => {
    const db = await makeDb();
    const a = await makeLyricTrack(db, "Two singers");
    const b = await makeLyricTrack(db, "One loud singer");

    await makeSignal(db, a.rev.id, { fingerprint: "fp-a1" });
    await makeSignal(db, a.rev.id, { fingerprint: "fp-a2", type: "clean_playthrough" });
    // Three events, all the same person.
    await makeSignal(db, b.rev.id, { fingerprint: "fp-b1" });
    await makeSignal(db, b.rev.id, { fingerprint: "fp-b1", type: "clean_playthrough" });
    await makeSignal(db, b.rev.id, { fingerprint: "fp-b1", type: "offset_correction", value: 100 });

    const rows = await listMostUsedTracks(db);
    expect(rows.map((r) => [r.trackName, r.singers])).toEqual([
      ["Two singers", 2],
      ["One loud singer", 1],
    ]);
  });

  it("counts signal and comment authors as usage", async () => {
    const db = await makeDb();
    const quiet = await makeLyricTrack(db, "Untouched", Date.now() - 1000);
    const active = await makeLyricTrack(db, "Sung and discussed");

    await makeSignal(db, active.rev.id, { fingerprint: "fp-singer" });
    await makeSignal(db, active.rev.id, { fingerprint: "fp-singer", type: "clean_playthrough" });
    await makeComment(db, active.track.id, active.rev.id);

    const rows = await listMostUsedTracks(db);
    expect(rows[0].trackName).toBe("Sung and discussed");
    expect(rows[0].singers).toBe(2); // singer + comment author
    expect(rows[1].trackName).toBe("Untouched");
    expect(rows[1].singers).toBe(0);
  });

  it("ignores system fingerprints and falls back to newest-first", async () => {
    const db = await makeDb();
    const older = await makeLyricTrack(db, "Older", Date.now() - 60_000);
    const newer = await makeLyricTrack(db, "Newer", Date.now());
    await makeSignal(db, older.rev.id, { fingerprint: "system:sync-queue" });

    const rows = await listMostUsedTracks(db);
    expect(rows.map((r) => [r.trackName, r.singers])).toEqual([
      ["Newer", 0],
      ["Older", 0],
    ]);
  });

  it("respects the limit", async () => {
    const db = await makeDb();
    for (let i = 0; i < 4; i++) await makeLyricTrack(db, `Track ${i}`);
    expect(await listMostUsedTracks(db, 2)).toHaveLength(2);
  });
});
