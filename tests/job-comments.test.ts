import { describe, expect, it } from "vitest";
import {
  deleteSyncJobComment,
  getWantedSongDetail,
  insertSyncJobComment,
  listRecentSyncJobComments,
  listSyncJobComments,
} from "@/lib/db/queries";
import { makeDb, makeSyncJob } from "./helpers";

describe("sync job comments", () => {
  it("inserts and lists oldest first", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db);

    const first = await insertSyncJobComment(db, {
      jobId: job.id,
      body: "please this one",
      authorUserId: "u1",
      authorName: "Mika",
    });
    const second = await insertSyncJobComment(db, {
      jobId: job.id,
      body: "seconded",
      authorUserId: "u2",
      authorName: null,
    });

    const listed = await listSyncJobComments(db, job.id);
    expect(listed.map((c) => c.id)).toEqual([first.id, second.id]);
    expect(listed[0].authorName).toBe("Mika");
    expect(listed[1].authorName).toBeNull();
  });

  it("lists recent comments newest first with their job", async () => {
    const db = await makeDb();
    const jobA = await makeSyncJob(db);
    const jobB = await makeSyncJob(db);
    await insertSyncJobComment(db, { jobId: jobA.id, body: "a", authorUserId: "u1", authorName: null });
    await insertSyncJobComment(db, { jobId: jobB.id, body: "b", authorUserId: "u1", authorName: null });

    const recent = await listRecentSyncJobComments(db, 10);
    expect(recent[0].comment.body).toBe("b");
    expect(recent[0].job.id).toBe(jobB.id);
    expect(recent[1].job.trackName).toBe(jobA.trackName);
  });

  it("delete is idempotent-safe", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db);
    const c = await insertSyncJobComment(db, { jobId: job.id, body: "x", authorUserId: "u1", authorName: null });

    expect(await deleteSyncJobComment(db, c.id)).toBe(true);
    expect(await deleteSyncJobComment(db, c.id)).toBe(false);
    expect(await listSyncJobComments(db, job.id)).toHaveLength(0);
  });

  it("getWantedSongDetail returns any status and full lyrics", async () => {
    const db = await makeDb();
    const job = await makeSyncJob(db, {
      status: "rejected",
      rejectionReason: "no lawful audio",
      plainLyrics: "full text stays intact\nline two",
    });

    const detail = await getWantedSongDetail(db, job.id);
    expect(detail).not.toBeNull();
    expect(detail!.job.status).toBe("rejected");
    expect(detail!.job.plainLyrics).toContain("full text stays intact");
    expect(detail!.voters).toBe(0);

    expect(await getWantedSongDetail(db, 999_999)).toBeNull();
  });
});
