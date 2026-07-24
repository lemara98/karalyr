import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { revisions, type Signal } from "@/lib/db/schema";
import { netScore } from "@/lib/ranking";
import { RECENT_DOWN_WINDOW_MS, runPromotionChecks } from "@/lib/promotion";
import { makeDb, makeRevision, makeSignal, makeTrack } from "./helpers";

const NOW = 1_750_000_000_000;

function sig(type: Signal["type"], fingerprint: string): Signal {
  return {
    id: 0,
    revisionId: 1,
    type,
    value: null,
    reason: type === "content_report" ? "wrong_words" : null,
    note: null,
    fingerprint,
    createdAt: 1000,
  };
}

describe("content_report signal", () => {
  it("netScore subtracts distinct content_report fingerprints (deduped per fp)", () => {
    const s = [
      sig("explicit_up", "a"),
      sig("content_report", "b"),
      sig("content_report", "b"), // same fingerprint: counts once
      sig("content_report", "c"),
    ];
    expect(netScore(s)).toBe(1 - 2);
  });

  it("blocks tier promotion while a content_report is recent, then allows it after the window", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id, { tier: "auto_aligned" });

    for (const fp of ["a", "b", "c"]) {
      await makeSignal(db, rev.id, { fingerprint: fp, createdAt: NOW - 100 });
    }
    await makeSignal(db, rev.id, {
      type: "content_report",
      reason: "wrong_words",
      fingerprint: "d",
      createdAt: NOW - 1000,
    });

    // 3 positives are present, but the recent report holds promotion back.
    expect((await runPromotionChecks(db, rev.id, NOW)).promoted).toBe(false);
    const [blocked] = await db.select().from(revisions).where(eq(revisions.id, rev.id));
    expect(blocked.tier).toBe("auto_aligned");

    // Once the report ages past the 7-day window, promotion proceeds.
    const later = NOW + RECENT_DOWN_WINDOW_MS + 1;
    expect((await runPromotionChecks(db, rev.id, later)).promoted).toBe(true);
    const [promoted] = await db.select().from(revisions).where(eq(revisions.id, rev.id));
    expect(promoted.tier).toBe("community");
  });
});
