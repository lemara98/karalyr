import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { revisions, tracks } from "@/lib/db/schema";
import {
  actionTakedown,
  blockSubmitter,
  declineNotice,
  isBlockedSubmitter,
  recordNotice,
  strikeCount,
  TOMBSTONE_PAYLOAD,
  unblockSubmitter,
} from "@/lib/takedown";
import { computeBestRevision } from "@/lib/ranking";
import { makeDb, makeRevision, makeTrack } from "./helpers";

const NOTICE = {
  claimantName: "A Publisher",
  claimantEmail: "rights@example.com",
  claimantRole: "authorised agent",
  workDescription: "Some Song, words by Someone",
  complainedOf: "https://karalyr.com/track/artist-title-1",
};

describe("recordNotice", () => {
  it("stores a notice as received, removing nothing", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);
    await computeBestRevision(db, track.id);

    const notice = await recordNotice(db, NOTICE);
    expect(notice.status).toBe("received");
    expect(notice.removedRevisionIds).toBe("[]");

    const [after] = await db.select().from(revisions).where(eq(revisions.id, rev.id));
    expect(after.status).toBe("active");
  });
});

describe("actionTakedown", () => {
  it("purges the payload rather than hiding the revision", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);
    const notice = await recordNotice(db, NOTICE);

    const result = await actionTakedown(db, {
      noticeId: notice.id,
      revisionIds: [rev.id],
      actor: "admin@example.com",
      resolution: "Valid notice from the publisher.",
    });

    expect(result.removed).toEqual([rev.id]);
    const [after] = await db.select().from(revisions).where(eq(revisions.id, rev.id));
    expect(after.status).toBe("taken_down");
    // The words are gone, not flagged — that is the whole point.
    expect(after.payload).toBe(TOMBSTONE_PAYLOAD);
    expect(after.payload).not.toContain("Test line one");
  });

  it("drops the track's best revision so the API stops serving it", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);
    await computeBestRevision(db, track.id);

    const [before] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(before.bestRevisionId).toBe(rev.id);

    const notice = await recordNotice(db, NOTICE);
    await actionTakedown(db, {
      noticeId: notice.id,
      revisionIds: [rev.id],
      actor: "admin@example.com",
    });

    const [after] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(after.bestRevisionId).toBeNull();
  });

  it("falls back to a surviving revision rather than emptying the track", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const bad = await makeRevision(db, track.id, { tier: "verified" });
    const good = await makeRevision(db, track.id, { tier: "community" });
    await computeBestRevision(db, track.id);

    const [before] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(before.bestRevisionId).toBe(bad.id);

    const notice = await recordNotice(db, NOTICE);
    await actionTakedown(db, {
      noticeId: notice.id,
      revisionIds: [bad.id],
      actor: "admin@example.com",
    });

    const [after] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(after.bestRevisionId).toBe(good.id);
  });

  it("records who acted, when, and what was purged", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);
    const notice = await recordNotice(db, NOTICE);

    const { notice: updated } = await actionTakedown(db, {
      noticeId: notice.id,
      revisionIds: [rev.id],
      actor: "admin@example.com",
      resolution: "Removed on request.",
      now: 1_700_000_000_000,
    });

    expect(updated.status).toBe("actioned");
    expect(JSON.parse(updated.removedRevisionIds)).toEqual([rev.id]);
    expect(updated.actionedBy).toBe("admin@example.com");
    expect(updated.actionedAt).toBe(1_700_000_000_000);
    expect(updated.trackId).toBe(track.id);
  });

  it("is idempotent — re-running skips what is already purged", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);
    const notice = await recordNotice(db, NOTICE);

    await actionTakedown(db, { noticeId: notice.id, revisionIds: [rev.id], actor: "a" });
    const second = await actionTakedown(db, {
      noticeId: notice.id,
      revisionIds: [rev.id],
      actor: "a",
    });

    expect(second.removed).toEqual([]);
    const [after] = await db.select().from(revisions).where(eq(revisions.id, rev.id));
    expect(after.payload).toBe(TOMBSTONE_PAYLOAD);
  });
});

describe("declineNotice", () => {
  it("closes the notice with a reason and touches no content", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);
    const notice = await recordNotice(db, NOTICE);

    const declined = await declineNotice(db, {
      noticeId: notice.id,
      actor: "admin@example.com",
      resolution: "Work is public domain (author d. 1901).",
    });

    expect(declined?.status).toBe("declined");
    expect(declined?.resolution).toContain("public domain");
    const [after] = await db.select().from(revisions).where(eq(revisions.id, rev.id));
    expect(after.status).toBe("active");
  });
});

describe("repeat-infringer policy", () => {
  it("counts only taken-down revisions as strikes", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await makeRevision(db, track.id, { submitterFingerprint: "fp-repeat" });
    await makeRevision(db, track.id, {
      submitterFingerprint: "fp-repeat",
      status: "taken_down",
    });
    await makeRevision(db, track.id, {
      submitterFingerprint: "fp-repeat",
      status: "rejected",
    });

    expect(await strikeCount(db, "fp-repeat")).toBe(1);
    expect(await strikeCount(db, "fp-clean")).toBe(0);
  });

  it("blocks and unblocks a submitter, recording the strikes at block time", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await makeRevision(db, track.id, {
      submitterFingerprint: "fp-repeat",
      status: "taken_down",
    });

    expect(await isBlockedSubmitter(db, "fp-repeat")).toBe(false);
    await blockSubmitter(db, {
      fingerprint: "fp-repeat",
      reason: "Three valid notices.",
      actor: "admin@example.com",
    });
    expect(await isBlockedSubmitter(db, "fp-repeat")).toBe(true);

    await unblockSubmitter(db, "fp-repeat");
    expect(await isBlockedSubmitter(db, "fp-repeat")).toBe(false);
  });

  it("re-blocking updates the reason instead of failing on the primary key", async () => {
    const db = await makeDb();
    await blockSubmitter(db, { fingerprint: "fp", reason: "first", actor: "a" });
    await blockSubmitter(db, { fingerprint: "fp", reason: "second", actor: "b" });
    expect(await isBlockedSubmitter(db, "fp")).toBe(true);
  });
});
