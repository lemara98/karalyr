import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { linkTrackVideo } from "@/lib/db/queries";
import { revisions, syncJobs, tracks, trackVideos } from "@/lib/db/schema";
import { importAlignedPayload } from "@/lib/aligned-import";
import {
  claimNextJob,
  completeJob,
  enqueueSyncJob,
  failJob,
  getOwnedProcessingJob,
  heartbeatJob,
  moderateSyncJob,
  RECENT_FAILURE_COOLDOWN_MS,
  RECLAIM_DELAY_MS,
  RETRY_BACKOFF_MS,
  type EnqueueInput,
} from "@/lib/sync-queue/core";
import { makeDb, makeRevision, makeTrack, samplePayload } from "./helpers";

const T0 = 1_700_000_000_000;
const YT_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const YT_KEY = "yt:dQw4w9WgXcQ";
const LYRICS = "First line here\nSecond line here\nThird line here\nFourth line here";

function input(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    source: "extension",
    videoUrl: YT_URL,
    artistName: "Test Artist",
    trackName: "Test Track",
    rawLyrics: LYRICS,
    submitterUserId: "00000000-0000-0000-0000-000000000001",
    submitterName: "Tester",
    ...overrides,
  };
}

let db: Db;
beforeEach(async () => {
  db = await makeDb();
});

describe("enqueueSyncJob", () => {
  it("queues extension submissions immediately with stripped lyrics", async () => {
    const res = await enqueueSyncJob(
      db,
      input({ rawLyrics: "[00:01.00]First line here\n[00:02.00]Second line here\nThird line here\nFourth line here" }),
      T0
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.job.status).toBe("queued");
    expect(res.job.source).toBe("extension");
    expect(res.job.videoKey).toBe(YT_KEY);
    expect(res.job.plainLyrics).toBe(LYRICS);
    expect(res.job.submitterUserId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("parks website submissions in pending_approval", async () => {
    const res = await enqueueSyncJob(db, input({ source: "website" }), T0);
    expect(res.ok && res.job.status).toBe("pending_approval");
  });

  it("rejects non-YouTube sources", async () => {
    const res = await enqueueSyncJob(
      db,
      input({ videoUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" }),
      T0
    );
    expect(!res.ok && res.code).toBe("UnsupportedSource");
  });

  it("rejects lyrics with fewer than 4 lines", async () => {
    const res = await enqueueSyncJob(db, input({ rawLyrics: "one\ntwo\nthree" }), T0);
    expect(!res.ok && res.code).toBe("BadLyrics");
  });

  it("AlreadySynced when the video's track has active word-timed lyrics", async () => {
    const track = await makeTrack(db);
    await makeRevision(db, track.id); // samplePayload has has_word_timing: true
    await linkTrackVideo(db, track.id, YT_KEY);

    const res = await enqueueSyncJob(db, input(), T0);
    expect(!res.ok && res.code).toBe("AlreadySynced");
    expect(!res.ok && res.trackId).toBe(track.id);
  });

  it("allows a track with only line-synced (no word timing) lyrics", async () => {
    const track = await makeTrack(db);
    const payload = samplePayload();
    payload.meta.has_word_timing = false;
    payload.lines.forEach((l) => delete l.words);
    await makeRevision(db, track.id, { payload: JSON.stringify(payload) });
    await linkTrackVideo(db, track.id, YT_KEY);

    const res = await enqueueSyncJob(db, input(), T0);
    expect(res.ok).toBe(true);
  });

  it("ignores rejected word-timed revisions for dedup", async () => {
    const track = await makeTrack(db);
    await makeRevision(db, track.id, { status: "rejected" });
    await linkTrackVideo(db, track.id, YT_KEY);

    const res = await enqueueSyncJob(db, input(), T0);
    expect(res.ok).toBe(true);
  });

  it("AlreadySynced for word-timed revisions stuck in pending_review (Rule C)", async () => {
    const track = await makeTrack(db);
    await makeRevision(db, track.id, { status: "pending_review" });
    await linkTrackVideo(db, track.id, YT_KEY);

    const res = await enqueueSyncJob(db, input(), T0);
    expect(!res.ok && res.code).toBe("AlreadySynced");
  });

  it("AlreadyQueued when a live job holds the video's slot", async () => {
    await enqueueSyncJob(db, input(), T0);
    const res = await enqueueSyncJob(db, input({ source: "website" }), T0);
    expect(!res.ok && res.code).toBe("AlreadyQueued");
  });

  it("partial unique index rejects a second live row but allows settled ones", async () => {
    const base = {
      source: "extension" as const,
      videoKey: YT_KEY,
      videoUrl: YT_URL,
      artistName: "A",
      trackName: "T",
      plainLyrics: LYRICS,
      submitterUserId: "u1",
      createdAt: T0,
      updatedAt: T0,
    };
    await db.insert(syncJobs).values({ ...base, status: "done" });
    await db.insert(syncJobs).values({ ...base, status: "failed" });
    await db.insert(syncJobs).values({ ...base, status: "queued" });
    const err = await db
      .insert(syncJobs)
      .values({ ...base, status: "processing" })
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(err).toBeTruthy();
    expect(String((err as Error).cause ?? err)).toMatch(/UNIQUE constraint failed/);
  });

  it("cooldown: extension refused after a recent failure, website allowed", async () => {
    const first = await enqueueSyncJob(db, input(), T0);
    expect(first.ok).toBe(true);
    const claimed = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, claimed!.id, "w1", "boom", true, T0);

    const ext = await enqueueSyncJob(db, input(), T0 + 1000);
    expect(!ext.ok && ext.code).toBe("RecentlyFailed");

    const web = await enqueueSyncJob(db, input({ source: "website" }), T0 + 1000);
    expect(web.ok).toBe(true);
  });

  it("cooldown expires", async () => {
    await enqueueSyncJob(db, input(), T0);
    const claimed = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, claimed!.id, "w1", "boom", true, T0);

    const res = await enqueueSyncJob(db, input(), T0 + RECENT_FAILURE_COOLDOWN_MS + 1);
    expect(res.ok).toBe(true);
  });
});

describe("moderateSyncJob", () => {
  async function pendingJob() {
    const res = await enqueueSyncJob(db, input({ source: "website" }), T0);
    if (!res.ok) throw new Error("enqueue failed");
    return res.job;
  }

  it("approve: pending_approval → queued", async () => {
    const job = await pendingJob();
    const out = await moderateSyncJob(db, job.id, "approve", undefined, T0 + 1);
    expect(out?.status).toBe("queued");
  });

  it("reject stores the reason", async () => {
    const job = await pendingJob();
    const out = await moderateSyncJob(db, job.id, "reject", "wrong lyrics", T0 + 1);
    expect(out?.status).toBe("rejected");
    expect(out?.rejectionReason).toBe("wrong lyrics");
  });

  it("cancel works from queued too", async () => {
    const job = await pendingJob();
    await moderateSyncJob(db, job.id, "approve");
    const out = await moderateSyncJob(db, job.id, "cancel");
    expect(out?.status).toBe("cancelled");
  });

  it("wrong-state transitions conflict (null)", async () => {
    const job = await pendingJob();
    expect(await moderateSyncJob(db, job.id, "retry")).toBeNull();
    await moderateSyncJob(db, job.id, "reject");
    expect(await moderateSyncJob(db, job.id, "approve")).toBeNull();
  });

  it("retry resets attempts and clears the error", async () => {
    await enqueueSyncJob(db, input(), T0);
    const claimed = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, claimed!.id, "w1", "boom", true, T0);

    const out = await moderateSyncJob(db, claimed!.id, "retry", undefined, T0 + 1);
    expect(out?.status).toBe("queued");
    expect(out?.attempts).toBe(0);
    expect(out?.lastError).toBeNull();
    expect(out?.nextAttemptAt).toBeNull();
  });

  it("retry conflicts when another live job holds the video slot", async () => {
    await enqueueSyncJob(db, input(), T0);
    const claimed = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, claimed!.id, "w1", "boom", true, T0);
    // Website re-submission takes the slot while the failed row sits there.
    const again = await enqueueSyncJob(db, input({ source: "website" }), T0 + 1000);
    expect(again.ok).toBe(true);

    expect(await moderateSyncJob(db, claimed!.id, "retry")).toBeNull();
  });
});

describe("claimNextJob", () => {
  it("claims the oldest eligible job and increments attempts", async () => {
    await enqueueSyncJob(db, input(), T0);
    await enqueueSyncJob(
      db,
      input({ videoUrl: "https://www.youtube.com/watch?v=abcdefghijk" }),
      T0 + 1
    );

    const job = await claimNextJob(db, "w1", 60_000, T0 + 10);
    expect(job?.videoKey).toBe(YT_KEY);
    expect(job?.status).toBe("processing");
    expect(job?.claimedBy).toBe("w1");
    expect(job?.attempts).toBe(1);
    expect(job?.leaseExpiresAt).toBe(T0 + 10 + 60_000);
  });

  it("returns null when nothing is eligible", async () => {
    expect(await claimNextJob(db, "w1", 60_000, T0)).toBeNull();
    const res = await enqueueSyncJob(db, input({ source: "website" }), T0);
    expect(res.ok).toBe(true); // pending_approval is not claimable
    expect(await claimNextJob(db, "w1", 60_000, T0)).toBeNull();
  });

  it("respects next_attempt_at backoff", async () => {
    await enqueueSyncJob(db, input(), T0);
    const first = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, first!.id, "w1", "transient", false, T0 + 1);

    expect(await claimNextJob(db, "w1", 1000, T0 + 2)).toBeNull();
    const retried = await claimNextJob(db, "w1", 1000, T0 + 1 + RETRY_BACKOFF_MS + 1);
    expect(retried?.id).toBe(first!.id);
    expect(retried?.attempts).toBe(2);
  });

  it("exactly one concurrent claimer wins a single job", async () => {
    await enqueueSyncJob(db, input(), T0);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => claimNextJob(db, `w${i}`, 60_000, T0))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reclaims expired leases with retries left, after a delay", async () => {
    await enqueueSyncJob(db, input(), T0);
    const job = await claimNextJob(db, "w1", 1000, T0);
    expect(job).not.toBeNull();

    // Lease expired but the reclaim delay gates the next claim.
    const tooSoon = await claimNextJob(db, "w2", 1000, T0 + 2000);
    expect(tooSoon).toBeNull();
    const [row] = await db.select().from(syncJobs).where(eq(syncJobs.id, job!.id));
    expect(row.status).toBe("queued");
    expect(row.nextAttemptAt).toBe(T0 + 2000 + RECLAIM_DELAY_MS);

    const reclaimed = await claimNextJob(db, "w2", 1000, T0 + 2000 + RECLAIM_DELAY_MS + 1);
    expect(reclaimed?.id).toBe(job!.id);
    expect(reclaimed?.attempts).toBe(2);
    expect(reclaimed?.claimedBy).toBe("w2");
  });

  it("buries expired leases that are out of attempts", async () => {
    await enqueueSyncJob(db, input(), T0);
    const j1 = await claimNextJob(db, "w1", 1000, T0);
    // First call after expiry sweeps (requeues with the reclaim delay); the
    // claim itself lands on the call after the delay passes.
    const t1 = T0 + 2000;
    expect(await claimNextJob(db, "w1", 1000, t1)).toBeNull();
    const j2 = await claimNextJob(db, "w1", 1000, t1 + RECLAIM_DELAY_MS + 1); // attempt 2 (= maxAttempts)
    expect(j2?.id).toBe(j1!.id);

    await claimNextJob(db, "w2", 1000, t1 + RECLAIM_DELAY_MS + 1 + 2000);
    const [row] = await db.select().from(syncJobs).where(eq(syncJobs.id, j1!.id));
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("worker lease expired");
  });
});

describe("heartbeat / complete / fail", () => {
  async function processingJob() {
    await enqueueSyncJob(db, input(), T0);
    const job = await claimNextJob(db, "w1", 60_000, T0);
    if (!job) throw new Error("claim failed");
    return job;
  }

  it("heartbeat extends the owner's lease", async () => {
    const job = await processingJob();
    const out = await heartbeatJob(db, job.id, "w1", 60_000, T0 + 5000);
    expect(out?.leaseExpiresAt).toBe(T0 + 5000 + 60_000);
  });

  it("heartbeat by a non-owner conflicts", async () => {
    const job = await processingJob();
    expect(await heartbeatJob(db, job.id, "w2", 60_000, T0 + 5000)).toBeNull();
    expect(await getOwnedProcessingJob(db, job.id, "w2")).toBeNull();
    expect(await getOwnedProcessingJob(db, job.id, "w1")).not.toBeNull();
  });

  it("complete records the import result", async () => {
    const job = await processingJob();
    const imported = await importAlignedPayload(db, {
      payload: samplePayload(),
      artist: job.artistName,
      track: job.trackName,
      duration: 213,
      videoUrl: job.videoUrl,
      submitterFingerprint: "system:sync-queue",
    });
    expect(imported.revisionStatus).toBe("active");

    const out = await completeJob(db, job.id, "w1", imported, T0 + 1000);
    expect(out?.status).toBe("done");
    expect(out?.resultTrackId).toBe(imported.trackId);
    expect(out?.resultRevisionId).toBe(imported.revisionId);

    const [video] = await db.select().from(trackVideos).where(eq(trackVideos.videoKey, YT_KEY));
    expect(video?.trackId).toBe(imported.trackId);
    const [rev] = await db.select().from(revisions).where(eq(revisions.id, imported.revisionId));
    expect(rev?.tier).toBe("auto_aligned");
    expect(rev?.submitterFingerprint).toBe("system:sync-queue");
  });

  it("Rule C: import under a verified best revision reports pending_review", async () => {
    const track = await makeTrack(db);
    const verified = await makeRevision(db, track.id, { tier: "verified" });
    await db.update(tracks).set({ bestRevisionId: verified.id }).where(eq(tracks.id, track.id));

    const imported = await importAlignedPayload(db, {
      payload: samplePayload(),
      artist: track.artistName,
      track: track.trackName,
      duration: track.durationSeconds,
      submitterFingerprint: "system:sync-queue",
    });
    expect(imported.trackId).toBe(track.id);
    expect(imported.revisionStatus).toBe("pending_review");
  });

  it("non-permanent fail requeues with backoff; permanent buries", async () => {
    const job = await processingJob();
    const out = await failJob(db, job.id, "w1", "network blip", false, T0 + 1000);
    expect(out?.status).toBe("queued");
    expect(out?.nextAttemptAt).toBe(T0 + 1000 + RETRY_BACKOFF_MS);
    expect(out?.lastError).toBe("network blip");

    const again = await claimNextJob(db, "w1", 60_000, T0 + 1000 + RETRY_BACKOFF_MS + 1);
    const buried = await failJob(db, again!.id, "w1", "Video unavailable", true, T0 + 2000);
    expect(buried?.status).toBe("failed");
  });

  it("fail by a non-owner conflicts", async () => {
    const job = await processingJob();
    expect(await failJob(db, job.id, "w2", "nope", false, T0 + 1)).toBeNull();
  });
});
