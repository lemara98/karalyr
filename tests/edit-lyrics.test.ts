import { describe, expect, it } from "vitest";
import { syncJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { editJob } from "@/lib/sync-queue/core";
import { makeDb, makeSyncJob } from "./helpers";

describe("editJob", () => {
  it("replaces the lyrics of a waiting job, normalized like intake", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db);

    const result = await editJob(
      db,
      job.id,
      { lyrics: "[00:01.00]Line one fixed\nLine two\nLine three\nLine four" },
      Date.now()
    );
    expect(result).toEqual({ ok: true, lineCount: 4 });

    const [row] = await db.select().from(syncJobs).where(eq(syncJobs.id, job.id));
    // LRC tags are stripped, exactly like the intake path.
    expect(row.plainLyrics).toBe("Line one fixed\nLine two\nLine three\nLine four");
  });

  it("rejects lyrics below the minimum line count", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db);

    const result = await editJob(db, job.id, { lyrics: "just one line" }, Date.now());
    expect(result).toEqual({ ok: false, reason: "bad_lyrics" });

    const [row] = await db.select().from(syncJobs).where(eq(syncJobs.id, job.id));
    expect(row.plainLyrics).toBe(job.plainLyrics); // untouched
  });

  it("corrects artist/track/album and recomputes the dedup song key", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db);

    const result = await editJob(
      db,
      job.id,
      { artistName: "  Bajaga i Instruktori ", trackName: "Ni na nebu, ni na zemlji", albumName: "Muzika na struju" },
      Date.now()
    );
    expect(result).toEqual({ ok: true, lineCount: null });

    const [row] = await db.select().from(syncJobs).where(eq(syncJobs.id, job.id));
    expect(row.artistName).toBe("Bajaga i Instruktori"); // trimmed
    expect(row.trackName).toBe("Ni na nebu, ni na zemlji");
    expect(row.albumName).toBe("Muzika na struju");
    expect(row.plainLyrics).toBe(job.plainLyrics); // untouched
    // Identity follows the corrected names, so a new want for the fixed
    // spelling dedups onto this job.
    expect(row.songKey).toBe("bajaga i instruktori|ni na nebu ni na zemlji");
  });

  it("recomputes the song key when only one name changes, and clears album on null", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db, { albumName: "Old Album" });

    const result = await editJob(db, job.id, { artistName: "Renamed", albumName: null }, Date.now());
    expect(result).toEqual({ ok: true, lineCount: null });

    const [row] = await db.select().from(syncJobs).where(eq(syncJobs.id, job.id));
    expect(row.trackName).toBe(job.trackName); // untouched
    expect(row.albumName).toBeNull();
    expect(row.songKey).toBe(`renamed|${job.trackName.toLowerCase()}`);
  });

  it("rejects blank names", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db);

    expect(await editJob(db, job.id, { artistName: "   " }, Date.now())).toEqual({
      ok: false,
      reason: "bad_metadata",
    });
    expect(await editJob(db, job.id, { trackName: "" }, Date.now())).toEqual({
      ok: false,
      reason: "bad_metadata",
    });
  });

  it("refuses a rename onto another active job's song identity", async () => {
    const db = await makeDb();
    const taken = await makeSyncJob(db);
    const job = await makeSyncJob(db);

    const result = await editJob(
      db,
      job.id,
      { artistName: taken.artistName, trackName: taken.trackName },
      Date.now()
    );
    expect(result).toEqual({ ok: false, reason: "duplicate_song" });

    const [row] = await db.select().from(syncJobs).where(eq(syncJobs.id, job.id));
    expect(row.artistName).toBe(job.artistName); // untouched
    expect(row.songKey).toBe(job.songKey);
  });

  it("allows the rename when the identity holder is closed", async () => {
    const db = await makeDb();
    const closed = await makeSyncJob(db, { status: "rejected" });
    const job = await makeSyncJob(db);

    const result = await editJob(
      db,
      job.id,
      { artistName: closed.artistName, trackName: closed.trackName },
      Date.now()
    );
    expect(result).toEqual({ ok: true, lineCount: null });
  });

  it("refuses processing and closed jobs, and missing ids", async () => {
    const db = await makeDb();
    const good = { lyrics: "One\nTwo\nThree\nFour" };
    const processing = await makeSyncJob(db, { status: "processing" });
    const done = await makeSyncJob(db, { status: "done" });

    expect(await editJob(db, processing.id, good, Date.now())).toEqual({
      ok: false,
      reason: "not_editable",
    });
    expect(await editJob(db, done.id, good, Date.now())).toEqual({
      ok: false,
      reason: "not_editable",
    });
    expect(await editJob(db, 999_999, good, Date.now())).toEqual({
      ok: false,
      reason: "not_editable",
    });
    // Renames go through the same status guard.
    expect(await editJob(db, done.id, { artistName: "New Name" }, Date.now())).toEqual({
      ok: false,
      reason: "not_editable",
    });
  });
});
