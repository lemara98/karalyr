import { describe, expect, it } from "vitest";
import { syncJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { editJobLyrics } from "@/lib/sync-queue/core";
import { makeDb, makeSyncJob } from "./helpers";

describe("editJobLyrics", () => {
  it("replaces the lyrics of a waiting job, normalized like intake", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db);

    const result = await editJobLyrics(
      db,
      job.id,
      "[00:01.00]Line one fixed\nLine two\nLine three\nLine four",
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

    const result = await editJobLyrics(db, job.id, "just one line", Date.now());
    expect(result).toEqual({ ok: false, reason: "bad_lyrics" });

    const [row] = await db.select().from(syncJobs).where(eq(syncJobs.id, job.id));
    expect(row.plainLyrics).toBe(job.plainLyrics); // untouched
  });

  it("refuses processing and closed jobs, and missing ids", async () => {
    const db = await makeDb();
    const good = "One\nTwo\nThree\nFour";
    const processing = await makeSyncJob(db, { status: "processing" });
    const done = await makeSyncJob(db, { status: "done" });

    expect(await editJobLyrics(db, processing.id, good, Date.now())).toEqual({
      ok: false,
      reason: "not_editable",
    });
    expect(await editJobLyrics(db, done.id, good, Date.now())).toEqual({
      ok: false,
      reason: "not_editable",
    });
    expect(await editJobLyrics(db, 999_999, good, Date.now())).toEqual({
      ok: false,
      reason: "not_editable",
    });
  });
});
