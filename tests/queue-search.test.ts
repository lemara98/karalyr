import { describe, expect, it } from "vitest";
import { listMostWantedSongs, searchWantedSongs } from "@/lib/db/queries";
import { makeDb, makeJobVote, makeSyncJob } from "./helpers";

describe("searchWantedSongs", () => {
  it("matches each field, case-insensitively, including lyrics", async () => {
    const db = await makeDb();
    await makeSyncJob(db, {
      artistName: "Rada Manojlović",
      trackName: "Nikada više",
      albumName: "Grand Hits",
      plainLyrics: "Samo jednom u zivotu volela sam ja\nAli ta mi ljubav",
    });

    for (const q of ["rada", "NIKADA", "grand", "volela sam"]) {
      const { songs, total } = await searchWantedSongs(db, { q });
      expect(total, `q=${q}`).toBe(1);
      expect(songs[0].trackName).toBe("Nikada više");
    }
    expect((await searchWantedSongs(db, { q: "nonsense" })).total).toBe(0);
  });

  it("ANDs terms across fields", async () => {
    const db = await makeDb();
    await makeSyncJob(db, { artistName: "Alpha", plainLyrics: "sunshine rain" });
    await makeSyncJob(db, { artistName: "Beta", plainLyrics: "sunshine snow" });

    // One term from artist + one from lyrics must both hit the same job.
    expect((await searchWantedSongs(db, { q: "alpha sunshine" })).total).toBe(1);
    expect((await searchWantedSongs(db, { q: "alpha snow" })).total).toBe(0);
    expect((await searchWantedSongs(db, { q: "sunshine" })).total).toBe(2);
  });

  it("treats % and _ literally", async () => {
    const db = await makeDb();
    await makeSyncJob(db, { trackName: "100% Pure" });
    await makeSyncJob(db, { trackName: "Something else" });

    const { songs, total } = await searchWantedSongs(db, { q: "100%" });
    expect(total).toBe(1);
    expect(songs[0].trackName).toBe("100% Pure");
  });

  it("excludes closed requests from rows and total", async () => {
    const db = await makeDb();
    await makeSyncJob(db, { trackName: "Open one" });
    await makeSyncJob(db, { trackName: "Done one", status: "done" });
    await makeSyncJob(db, { trackName: "Rejected one", status: "rejected" });

    const { songs, total } = await searchWantedSongs(db, {});
    expect(total).toBe(1);
    expect(songs.map((s) => s.trackName)).toEqual(["Open one"]);
  });

  it("paginates with a deterministic order and clamps out-of-range pages", async () => {
    const db = await makeDb();
    const jobs = [];
    for (let i = 0; i < 5; i++) jobs.push(await makeSyncJob(db));
    // Two voters on the last-created job pushes it to rank 1.
    await makeJobVote(db, jobs[4].id, "u1");
    await makeJobVote(db, jobs[4].id, "u2");

    const page1 = await searchWantedSongs(db, { page: 1, perPage: 2 });
    expect(page1.total).toBe(5);
    expect(page1.songs).toHaveLength(2);
    expect(page1.songs[0].jobId).toBe(jobs[4].id); // most voters first
    expect(page1.songs[1].jobId).toBe(jobs[0].id); // then oldest

    const page2 = await searchWantedSongs(db, { page: 2, perPage: 2 });
    expect(page2.songs.map((s) => s.jobId)).toEqual([jobs[1].id, jobs[2].id]);

    // Out-of-range pages clamp to the last page; nonsense pages to the first.
    expect((await searchWantedSongs(db, { page: 99, perPage: 2 })).page).toBe(3);
    expect((await searchWantedSongs(db, { page: 99, perPage: 2 })).songs).toHaveLength(1);
    expect((await searchWantedSongs(db, { page: -3, perPage: 2 })).page).toBe(1);
  });

  it("listMostWantedSongs is page 1 of the unfiltered search", async () => {
    const db = await makeDb();
    for (let i = 0; i < 4; i++) await makeSyncJob(db);

    const viaList = await listMostWantedSongs(db, 3);
    const viaSearch = (await searchWantedSongs(db, { perPage: 3 })).songs;
    expect(viaList).toEqual(viaSearch);
    expect(viaList).toHaveLength(3);
  });
});
