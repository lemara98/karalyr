import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { linkTrackVideo } from "@/lib/db/queries";
import { revisions, syncJobVotes, syncJobs, tracks, trackVideos } from "@/lib/db/schema";
import { importAlignedPayload } from "@/lib/aligned-import";
import { songKey } from "@/lib/song-key";
import {
  claimNextJob,
  completeJob,
  enqueueSyncJob,
  failJob,
  getOwnedProcessingJob,
  heartbeatJob,
  moderateSyncJob,
  resolveWantedForTrack,
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

/**
 * A request an admin has promoted, i.e. actual work the pull worker can claim.
 * Intake alone never produces one — "wanted" is the only status a user can
 * reach — so every worker-lifecycle test goes through here.
 */
async function queuedJob(overrides: Partial<EnqueueInput> = {}, now = T0) {
  const res = await enqueueSyncJob(db, input(overrides), now);
  if (!res.ok) throw new Error(`enqueue failed: ${res.code}`);
  const promoted = await moderateSyncJob(db, res.job.id, "promote", undefined, now);
  if (!promoted) throw new Error("promote failed");
  return promoted;
}

describe("enqueueSyncJob", () => {
  it("records a request as wanted, with stripped lyrics", async () => {
    const res = await enqueueSyncJob(
      db,
      input({ rawLyrics: "[00:01.00]First line here\n[00:02.00]Second line here\nThird line here\nFourth line here" }),
      T0
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.job.status).toBe("wanted");
    expect(res.voted).toBe(false);
    expect(res.job.source).toBe("extension");
    expect(res.job.videoKey).toBe(YT_KEY);
    expect(res.job.songKey).toBe(songKey("Test Artist", "Test Track"));
    expect(res.job.plainLyrics).toBe(LYRICS);
    expect(res.job.submitterUserId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("no intake path can reach a worker-claimable status", async () => {
    for (const source of ["extension", "website"] as const) {
      const res = await enqueueSyncJob(db, input({ source, trackName: `T ${source}` }), T0);
      expect(res.ok && res.job.status).toBe("wanted");
    }
    // "wanted" is invisible to the worker until an admin promotes it.
    expect(await claimNextJob(db, "w1", 60_000, T0)).toBeNull();
  });

  it("accepts a Spotify link, and a request with no link at all", async () => {
    const sp = await enqueueSyncJob(
      db,
      input({ videoUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" }),
      T0
    );
    expect(sp.ok && sp.job.videoKey).toBe("sp:4uLU6hMCjMI75M1A2tKUQC");

    const bare = await enqueueSyncJob(db, input({ videoUrl: null, trackName: "No Link" }), T0);
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.job.videoKey).toBeNull();
    expect(bare.job.videoUrl).toBeNull();
  });

  it("rejects a link that isn't a recognisable source", async () => {
    const res = await enqueueSyncJob(db, input({ videoUrl: "https://example.com/song" }), T0);
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

  it("a second request votes on the existing one instead of opening another", async () => {
    const first = await enqueueSyncJob(db, input(), T0);
    const second = await enqueueSyncJob(
      db,
      input({ source: "website", submitterUserId: "user-2" }),
      T0 + 1
    );
    expect(second.ok && second.voted).toBe(true);
    expect(second.ok && second.job.id).toBe(first.ok && first.job.id);

    const rows = await db.select().from(syncJobs);
    expect(rows).toHaveLength(1);
    const votes = await db.select().from(syncJobVotes);
    expect(votes).toHaveLength(2); // the opener counts as the first voter
  });

  it("the same person asking twice does not inflate demand", async () => {
    await enqueueSyncJob(db, input(), T0);
    const again = await enqueueSyncJob(db, input(), T0 + 1);
    expect(again.ok && again.voted).toBe(true);
    expect(await db.select().from(syncJobVotes)).toHaveLength(1);
  });

  it("collapses the same song across spelling, casing and upload noise", async () => {
    await enqueueSyncJob(db, input({ artistName: "Đorđe", trackName: "Pesma" }), T0);
    const variant = await enqueueSyncJob(
      db,
      input({
        artistName: "ĐORĐE",
        trackName: "Pesma (Official Video) [HD]",
        submitterUserId: "user-2",
      }),
      T0 + 1
    );
    expect(variant.ok && variant.voted).toBe(true);
    expect(await db.select().from(syncJobs)).toHaveLength(1);
  });

  it("keeps every source offered, and upgrades the display link to an embeddable one", async () => {
    // Opened with a Spotify link, then someone supplies the YouTube video.
    const first = await enqueueSyncJob(
      db,
      input({ videoUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" }),
      T0
    );
    expect(first.ok && first.job.videoKey).toBe("sp:4uLU6hMCjMI75M1A2tKUQC");

    const second = await enqueueSyncJob(db, input({ submitterUserId: "user-2" }), T0 + 1);
    expect(second.ok && second.job.videoKey).toBe(YT_KEY);
    expect(second.ok && second.job.videoUrl).toBe(YT_URL);

    // Both links survive on the votes, so the want stays traceable to either.
    const votes = await db.select().from(syncJobVotes);
    expect(votes.map((v) => v.videoKey).sort()).toEqual(["sp:4uLU6hMCjMI75M1A2tKUQC", YT_KEY]);
  });

  it("does not downgrade an embeddable display link back to audio-only", async () => {
    await enqueueSyncJob(db, input(), T0);
    const second = await enqueueSyncJob(
      db,
      input({
        videoUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        submitterUserId: "user-2",
      }),
      T0 + 1
    );
    expect(second.ok && second.job.videoKey).toBe(YT_KEY);
  });

  it("partial unique index rejects a second live row but allows settled ones", async () => {
    const base = {
      source: "extension" as const,
      songKey: songKey("A", "T"),
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
    await queuedJob();
    const claimed = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, claimed!.id, "w1", "boom", true, T0);

    const ext = await enqueueSyncJob(db, input(), T0 + 1000);
    expect(!ext.ok && ext.code).toBe("RecentlyFailed");

    const web = await enqueueSyncJob(db, input({ source: "website" }), T0 + 1000);
    expect(web.ok).toBe(true);
  });

  it("cooldown expires", async () => {
    await queuedJob();
    const claimed = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, claimed!.id, "w1", "boom", true, T0);

    const res = await enqueueSyncJob(db, input(), T0 + RECENT_FAILURE_COOLDOWN_MS + 1);
    expect(res.ok).toBe(true);
  });
});

describe("resolveWantedForTrack", () => {
  it("an aligned import closes the open request for that song by itself", async () => {
    const res = await enqueueSyncJob(db, input(), T0);
    expect(res.ok && res.job.status).toBe("wanted");

    const imported = await importAlignedPayload(db, {
      payload: samplePayload(),
      artist: "Test Artist",
      track: "Test Track",
      duration: 213,
      submitterFingerprint: "system:offline-align",
    });

    // No explicit resolve call: importAlignedPayload closes wants itself, so
    // every fulfillment path that goes through it gets this for free.
    const [row] = await db.select().from(syncJobs);
    expect(row.status).toBe("done");
    expect(row.resultTrackId).toBe(imported.trackId);
  });

  it("matches on song identity, not on a shared link", async () => {
    // Requested with no link at all, and with noisier spelling than the track.
    await enqueueSyncJob(
      db,
      input({ videoUrl: null, artistName: "test  artist", trackName: "Test Track (Official Video)" }),
      T0
    );
    const track = await makeTrack(db, { artistName: "Test Artist", trackName: "Test Track" });
    await makeRevision(db, track.id);

    expect(await resolveWantedForTrack(db, track.id, T0 + 5)).toBe(1);
  });

  it("leaves a job a worker is holding alone", async () => {
    await queuedJob();
    const claimed = await claimNextJob(db, "w1", 60_000, T0);
    expect(claimed).not.toBeNull();

    const track = await makeTrack(db, { artistName: "Test Artist", trackName: "Test Track" });
    await makeRevision(db, track.id);

    // The worker owns this row and reports its own outcome.
    expect(await resolveWantedForTrack(db, track.id, T0 + 5)).toBe(0);
    const [row] = await db.select().from(syncJobs);
    expect(row.status).toBe("processing");
  });
});

describe("moderateSyncJob", () => {
  async function wantedJob() {
    const res = await enqueueSyncJob(db, input({ source: "website" }), T0);
    if (!res.ok) throw new Error("enqueue failed");
    return res.job;
  }

  it("promote: wanted → queued, the only way work reaches a worker", async () => {
    const job = await wantedJob();
    expect(job.status).toBe("wanted");
    const out = await moderateSyncJob(db, job.id, "promote", undefined, T0 + 1);
    expect(out?.status).toBe("queued");
  });

  it("reject stores the reason", async () => {
    const job = await wantedJob();
    const out = await moderateSyncJob(db, job.id, "reject", "wrong lyrics", T0 + 1);
    expect(out?.status).toBe("rejected");
    expect(out?.rejectionReason).toBe("wrong lyrics");
  });

  it("cancel works from queued too", async () => {
    const job = await wantedJob();
    await moderateSyncJob(db, job.id, "promote");
    const out = await moderateSyncJob(db, job.id, "cancel");
    expect(out?.status).toBe("cancelled");
  });

  it("wrong-state transitions conflict (null)", async () => {
    const job = await wantedJob();
    expect(await moderateSyncJob(db, job.id, "retry")).toBeNull();
    await moderateSyncJob(db, job.id, "reject");
    expect(await moderateSyncJob(db, job.id, "promote")).toBeNull();
  });

  it("retry resets attempts and clears the error", async () => {
    await queuedJob();
    const claimed = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, claimed!.id, "w1", "boom", true, T0);

    const out = await moderateSyncJob(db, claimed!.id, "retry", undefined, T0 + 1);
    expect(out?.status).toBe("queued");
    expect(out?.attempts).toBe(0);
    expect(out?.lastError).toBeNull();
    expect(out?.nextAttemptAt).toBeNull();
  });

  it("retry conflicts when another live request holds the song slot", async () => {
    await queuedJob();
    const claimed = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, claimed!.id, "w1", "boom", true, T0);
    // A new want takes the slot while the failed row sits there.
    const again = await enqueueSyncJob(
      db,
      input({ source: "website", submitterUserId: "user-2" }),
      T0 + 1000
    );
    expect(again.ok).toBe(true);

    expect(await moderateSyncJob(db, claimed!.id, "retry")).toBeNull();
  });
});

describe("claimNextJob", () => {
  it("claims the oldest eligible job and increments attempts", async () => {
    await queuedJob();
    await queuedJob(
      { videoUrl: "https://www.youtube.com/watch?v=abcdefghijk", trackName: "Other Track" },
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
    expect(res.ok).toBe(true); // wanted is not claimable
    expect(await claimNextJob(db, "w1", 60_000, T0)).toBeNull();
  });

  it("respects next_attempt_at backoff", async () => {
    await queuedJob();
    const first = await claimNextJob(db, "w1", 1000, T0);
    await failJob(db, first!.id, "w1", "transient", false, T0 + 1);

    expect(await claimNextJob(db, "w1", 1000, T0 + 2)).toBeNull();
    const retried = await claimNextJob(db, "w1", 1000, T0 + 1 + RETRY_BACKOFF_MS + 1);
    expect(retried?.id).toBe(first!.id);
    expect(retried?.attempts).toBe(2);
  });

  it("exactly one concurrent claimer wins a single job", async () => {
    await queuedJob();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => claimNextJob(db, `w${i}`, 60_000, T0))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reclaims expired leases with retries left, after a delay", async () => {
    await queuedJob();
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
    await queuedJob();
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
    await queuedJob();
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
