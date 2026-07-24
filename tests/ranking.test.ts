import { describe, expect, it } from "vitest";
import { netScore, rankRevisions, computeBestRevision } from "@/lib/ranking";
import { tracks, type Revision, type Signal } from "@/lib/db/schema";
import { makeDb, makeRevision, makeSignal, makeTrack, samplePayload } from "./helpers";
import { eq } from "drizzle-orm";

/** samplePayload with word timing stripped — the line-level legacy shape. */
function lineLevelPayload(): string {
  const p = samplePayload();
  return JSON.stringify({
    ...p,
    lines: p.lines.map(({ words: _words, ...line }) => line),
    meta: { ...p.meta, has_word_timing: false },
  });
}

let nextId = 1;
function rev(overrides: Partial<Revision>): Revision {
  return {
    id: nextId++,
    trackId: 1,
    source: "user_submission",
    tier: "community",
    payload: JSON.stringify(samplePayload()),
    parentRevisionId: null,
    submitterFingerprint: "fp",
    status: "active",
    createdAt: 1000,
    promotedAt: null,
    ...overrides,
  };
}

function sig(revisionId: number, overrides: Partial<Signal>): Signal {
  return {
    id: nextId++,
    revisionId,
    type: "explicit_up",
    value: null,
    reason: null,
    note: null,
    fingerprint: "fp-1",
    createdAt: 1000,
    ...overrides,
  };
}

describe("netScore", () => {
  it("dedupes by fingerprint per type and subtracts downs", () => {
    const s = [
      sig(1, { fingerprint: "a" }),
      sig(1, { fingerprint: "a" }), // duplicate up, ignored
      sig(1, { fingerprint: "b", type: "clean_playthrough" }),
      sig(1, { fingerprint: "a", type: "clean_playthrough" }), // same fp, different type: counts
      sig(1, { fingerprint: "c", type: "explicit_down" }),
    ];
    expect(netScore(s)).toBe(1 + 2 - 1);
  });
});

describe("rankRevisions", () => {
  it("higher tier beats more signals", () => {
    const low = rev({ tier: "auto_aligned" });
    const verified = rev({ tier: "verified" });
    const s = [sig(low.id, { fingerprint: "a" }), sig(low.id, { fingerprint: "b" })];
    expect(rankRevisions([low, verified], s)?.id).toBe(verified.id);
  });

  it("within a tier, net signals win", () => {
    const a = rev({ tier: "community", createdAt: 2000 });
    const b = rev({ tier: "community", createdAt: 1000 });
    const s = [
      sig(b.id, { fingerprint: "x" }),
      sig(b.id, { fingerprint: "y" }),
      sig(a.id, { fingerprint: "x", type: "explicit_down" }),
    ];
    expect(rankRevisions([a, b], s)?.id).toBe(b.id);
  });

  it("ties break to newest", () => {
    const older = rev({ createdAt: 1000 });
    const newer = rev({ createdAt: 2000 });
    expect(rankRevisions([older, newer], [])?.id).toBe(newer.id);
  });

  it("ignores non-active revisions entirely", () => {
    const pending = rev({ tier: "verified", status: "pending_review" });
    const rejected = rev({ tier: "verified", status: "rejected" });
    const reverted = rev({ tier: "verified", status: "reverted" });
    const active = rev({ tier: "auto_aligned" });
    expect(rankRevisions([pending, rejected, reverted, active], [])?.id).toBe(active.id);
    expect(rankRevisions([pending, rejected, reverted], [])).toBeNull();
  });

  it("never returns a line-level revision", () => {
    const lineOnly = rev({ payload: lineLevelPayload() });
    expect(rankRevisions([lineOnly], [])).toBeNull();
  });

  it("word-level low tier beats line-level high tier", () => {
    const lineVerified = rev({ tier: "verified", payload: lineLevelPayload() });
    const wordAligned = rev({ tier: "auto_aligned" });
    expect(rankRevisions([lineVerified, wordAligned], [])?.id).toBe(wordAligned.id);
  });

  it("treats unparseable payloads as line-level", () => {
    const broken = rev({ payload: "not json" });
    expect(rankRevisions([broken], [])).toBeNull();
  });

  it("ranks legacy tiers outside the enum below every known tier", () => {
    const legacy = rev({ tier: "imported" as never, createdAt: 2000 });
    const known = rev({ tier: "auto_aligned", createdAt: 1000 });
    expect(rankRevisions([legacy, known], [])?.id).toBe(known.id);
  });
});

describe("computeBestRevision", () => {
  it("materializes the winner onto tracks.best_revision_id", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const low = await makeRevision(db, track.id, { tier: "auto_aligned" });
    const high = await makeRevision(db, track.id, { tier: "community" });
    await makeSignal(db, low.id, { fingerprint: "a" });

    const bestId = await computeBestRevision(db, track.id);
    expect(bestId).toBe(high.id);

    const [row] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(row.bestRevisionId).toBe(high.id);
  });

  it("sets null when no active revisions exist", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await makeRevision(db, track.id, { status: "rejected" });
    expect(await computeBestRevision(db, track.id)).toBeNull();
  });

  it("sets null when only line-level revisions exist", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await makeRevision(db, track.id, { payload: lineLevelPayload() });
    expect(await computeBestRevision(db, track.id)).toBeNull();

    const [row] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(row.bestRevisionId).toBeNull();
  });
});
