import { describe, expect, it } from "vitest";
import { importAlignedPayload } from "@/lib/aligned-import";
import { FormatError } from "@/lib/formats";
import { revisions } from "@/lib/db/schema";
import { makeDb, samplePayload } from "./helpers";

describe("importAlignedPayload word-only rule", () => {
  it("throws FormatError on a payload without word timing", async () => {
    const db = await makeDb();
    const p = samplePayload();
    const lineLevel = {
      ...p,
      lines: p.lines.map(({ words: _words, ...line }) => line),
      meta: { ...p.meta, has_word_timing: false },
    };

    await expect(
      importAlignedPayload(db, {
        payload: lineLevel,
        artist: "A",
        track: "T",
        duration: 180,
        submitterFingerprint: "system:test",
      })
    ).rejects.toThrow(FormatError);
    expect(await db.select().from(revisions)).toHaveLength(0);
  });

  it("rejects a gutted payload even when the flag claims word timing", async () => {
    const db = await makeDb();
    const p = samplePayload();
    const gutted = {
      ...p,
      lines: p.lines.map(({ words: _words, ...line }) => line),
      // Older aligners asserted this even for empty output.
      meta: { ...p.meta, has_word_timing: true },
    };
    await expect(
      importAlignedPayload(db, {
        payload: gutted,
        artist: "A",
        track: "T",
        duration: 180,
        submitterFingerprint: "system:test",
      })
    ).rejects.toThrow(FormatError);
  });

  it("accepts a deliberate line-level payload only with allowLineLevel", async () => {
    const db = await makeDb();
    const p = samplePayload();
    const lineLevel = {
      ...p,
      lines: p.lines.map(({ words: _words, ...line }) => line),
      meta: { ...p.meta, has_word_timing: false, language: "lo" },
    };
    const result = await importAlignedPayload(db, {
      payload: lineLevel,
      artist: "A",
      track: "T",
      duration: 180,
      submitterFingerprint: "system:sync-queue",
      allowLineLevel: true,
    });
    const [rev] = await db.select().from(revisions);
    expect(rev.id).toBe(result.revisionId);
    // allowLineLevel never rescues a word-claiming-but-empty payload…
    const stillGuarded = {
      ...p,
      lines: [],
      meta: { ...p.meta, has_word_timing: false },
    };
    await expect(
      importAlignedPayload(db, {
        payload: stillGuarded,
        artist: "A2",
        track: "T2",
        duration: 180,
        submitterFingerprint: "system:sync-queue",
        allowLineLevel: true,
      })
    ).rejects.toThrow(FormatError);
  });

  it("imports a word-timed payload as auto_aligned", async () => {
    const db = await makeDb();
    const result = await importAlignedPayload(db, {
      payload: samplePayload(),
      artist: "A",
      track: "T",
      duration: 180,
      submitterFingerprint: "system:test",
    });
    const [rev] = await db.select().from(revisions);
    expect(rev.id).toBe(result.revisionId);
    expect(rev.tier).toBe("auto_aligned");
  });
});
