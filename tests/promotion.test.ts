import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { revisions, tracks } from "@/lib/db/schema";
import { runPromotionChecks, AUTO_OFFSET_FINGERPRINT } from "@/lib/promotion";
import { insertRevision } from "@/lib/db/queries";
import { computeBestRevision } from "@/lib/ranking";
import { validatePayload } from "@/lib/formats";
import { makeDb, makeRevision, makeSignal, makeTrack, samplePayload } from "./helpers";

const NOW = 1_750_000_000_000;

describe("Rule A: tier promotion", () => {
  it("promotes one tier at exactly 3 distinct positive fingerprints", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id, { tier: "auto_aligned" });

    await makeSignal(db, rev.id, { fingerprint: "a", createdAt: NOW - 100 });
    await makeSignal(db, rev.id, { fingerprint: "b", type: "clean_playthrough", createdAt: NOW - 90 });
    expect((await runPromotionChecks(db, rev.id, NOW)).promoted).toBe(false);

    await makeSignal(db, rev.id, { fingerprint: "c", createdAt: NOW - 80 });
    expect((await runPromotionChecks(db, rev.id, NOW)).promoted).toBe(true);

    const [after] = await db.select().from(revisions).where(eq(revisions.id, rev.id));
    expect(after.tier).toBe("community");
    expect(after.promotedAt).toBe(NOW);
  });

  it("does not double-count one fingerprint and does not re-promote on old signals", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id, { tier: "auto_aligned" });

    for (let i = 0; i < 5; i++) {
      await makeSignal(db, rev.id, { fingerprint: "same", createdAt: NOW - 100 + i });
    }
    expect((await runPromotionChecks(db, rev.id, NOW)).promoted).toBe(false);

    await makeSignal(db, rev.id, { fingerprint: "b", createdAt: NOW - 50 });
    await makeSignal(db, rev.id, { fingerprint: "c", createdAt: NOW - 40 });
    expect((await runPromotionChecks(db, rev.id, NOW)).promoted).toBe(true);

    // Same signals must not trigger a second promotion.
    expect((await runPromotionChecks(db, rev.id, NOW + 10)).promoted).toBe(false);
    const [after] = await db.select().from(revisions).where(eq(revisions.id, rev.id));
    expect(after.tier).toBe("community");
  });

  it("blocks promotion when a down arrived within 7 days", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id, { tier: "community" });

    for (const fp of ["a", "b", "c"]) {
      await makeSignal(db, rev.id, { fingerprint: fp, createdAt: NOW - 100 });
    }
    await makeSignal(db, rev.id, { fingerprint: "d", type: "explicit_down", createdAt: NOW - 1000 });
    expect((await runPromotionChecks(db, rev.id, NOW)).promoted).toBe(false);

    // A down older than 7 days does not block.
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    expect((await runPromotionChecks(db, rev.id, NOW + eightDays)).promoted).toBe(true);
  });

  it("never promotes past verified", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id, { tier: "verified" });
    for (const fp of ["a", "b", "c"]) {
      await makeSignal(db, rev.id, { fingerprint: fp, createdAt: NOW - 100 });
    }
    expect((await runPromotionChecks(db, rev.id, NOW)).promoted).toBe(false);
  });
});

describe("Rule B: auto offset correction", () => {
  it("creates a correction revision from the median of 3 agreeing offsets", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id, { tier: "community" });

    await makeSignal(db, rev.id, { type: "offset_correction", value: 200, fingerprint: "a", createdAt: NOW - 30 });
    await makeSignal(db, rev.id, { type: "offset_correction", value: 300, fingerprint: "b", createdAt: NOW - 20 });
    expect((await runPromotionChecks(db, rev.id, NOW)).correctionRevisionId).toBeNull();

    await makeSignal(db, rev.id, { type: "offset_correction", value: 250, fingerprint: "c", createdAt: NOW - 10 });
    const { correctionRevisionId } = await runPromotionChecks(db, rev.id, NOW);
    expect(correctionRevisionId).not.toBeNull();

    const [child] = await db.select().from(revisions).where(eq(revisions.id, correctionRevisionId!));
    expect(child).toMatchObject({
      source: "correction",
      tier: "community",
      parentRevisionId: rev.id,
      submitterFingerprint: AUTO_OFFSET_FINGERPRINT,
      status: "active",
    });

    // Median of [200, 250, 300] = 250; original first line starts at 1000.
    const payload = validatePayload(JSON.parse(child.payload));
    expect(payload.lines[0].start_ms).toBe(1250);
    expect(payload.lines[0].words![0].start_ms).toBe(1250);
  });

  it("does not trigger when offsets disagree beyond +-150ms of the median", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);

    await makeSignal(db, rev.id, { type: "offset_correction", value: 0, fingerprint: "a", createdAt: NOW - 30 });
    await makeSignal(db, rev.id, { type: "offset_correction", value: 100, fingerprint: "b", createdAt: NOW - 20 });
    await makeSignal(db, rev.id, { type: "offset_correction", value: 900, fingerprint: "c", createdAt: NOW - 10 });
    expect((await runPromotionChecks(db, rev.id, NOW)).correctionRevisionId).toBeNull();
  });

  it("does not re-trigger on the same signals after a correction exists", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);

    for (const [fp, v] of [["a", 100], ["b", 120], ["c", 140]] as const) {
      await makeSignal(db, rev.id, { type: "offset_correction", value: v, fingerprint: fp, createdAt: NOW - 10 });
    }
    const first = await runPromotionChecks(db, rev.id, NOW);
    expect(first.correctionRevisionId).not.toBeNull();

    const second = await runPromotionChecks(db, rev.id, NOW + 1000);
    expect(second.correctionRevisionId).toBeNull();

    const children = await db
      .select()
      .from(revisions)
      .where(eq(revisions.parentRevisionId, rev.id));
    expect(children).toHaveLength(1);
  });
});

describe("Rule C: verified tracks route edits to review", () => {
  it("new revisions go pending_review when best is verified, active otherwise", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);

    await makeRevision(db, track.id, { tier: "community" });
    await computeBestRevision(db, track.id);

    const edit1 = await insertRevision(db, {
      trackId: track.id,
      source: "user_submission",
      tier: "community",
      payload: samplePayload(2000),
      submitterFingerprint: "fp-edit",
    });
    expect(edit1.status).toBe("active");

    const verified = await makeRevision(db, track.id, { tier: "verified" });
    await computeBestRevision(db, track.id);

    const edit2 = await insertRevision(db, {
      trackId: track.id,
      source: "correction",
      tier: "community",
      payload: samplePayload(3000),
      parentRevisionId: verified.id,
      submitterFingerprint: "fp-edit",
    });
    expect(edit2.status).toBe("pending_review");

    // The pending edit must not affect the served best revision.
    const [row] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(row.bestRevisionId).toBe(verified.id);
  });
});
