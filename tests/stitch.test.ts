import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { lineObservations, revisions, tracks } from "@/lib/db/schema";
import { computeBestRevision } from "@/lib/ranking";
import {
  mergeLineObservations,
  runStitchCheck,
  STITCH_FINGERPRINT,
} from "@/lib/stitch";
import { validatePayload, type Line, type LyricsPayload } from "@/lib/formats";
import { makeDb, makeRevision, makeTrack } from "./helpers";
import type { Db } from "@/lib/db/client";

function linePayload(texts: string[], startMs = 4000, lineMs = 4000): LyricsPayload {
  return {
    format_version: 1,
    lines: texts.map((text, i) => ({
      start_ms: startMs + i * lineMs,
      end_ms: startMs + (i + 1) * lineMs,
      singer: null,
      text,
    })),
    meta: { language: "en", has_word_timing: false, countdown_lines: [] },
  };
}

function obsWords(line: Line, jitterMs = 0) {
  const texts = line.text.split(/\s+/).filter(Boolean);
  const per = Math.floor((line.end_ms - line.start_ms) / texts.length);
  return texts.map((text, i) => ({
    text,
    start_ms: line.start_ms + i * per + jitterMs,
    end_ms: line.start_ms + (i + 1) * per + jitterMs,
  }));
}

async function insertObs(
  db: Db,
  trackId: number,
  line: Line,
  opts: { jitterMs?: number; fingerprint?: string; confidence?: number; wordCount?: number } = {}
) {
  let words = obsWords(line, opts.jitterMs ?? 0);
  if (opts.wordCount !== undefined) words = words.slice(0, opts.wordCount);
  await db.insert(lineObservations).values({
    trackId,
    lineStartMs: line.start_ms,
    lineText: line.text,
    wordsJson: JSON.stringify(words),
    confidence: opts.confidence ?? 0.8,
    fingerprint: opts.fingerprint ?? "fp-observer",
    createdAt: Date.now(),
  });
}

const TEXTS = [
  "First test line here",
  "Second line of the song",
  "Third line keeps going",
  "Fourth line nearly done",
  "Fifth line wraps it up",
];

async function makeBaseTrack(db: Db, tier: "imported" | "community" = "imported") {
  const track = await makeTrack(db);
  const base = await makeRevision(db, track.id, {
    tier,
    source: "lrclib_import",
    payload: JSON.stringify(linePayload(TEXTS)),
  });
  await computeBestRevision(db, track.id);
  return { track, base, payload: linePayload(TEXTS) };
}

describe("mergeLineObservations", () => {
  const line: Line = { start_ms: 1000, end_ms: 4000, singer: null, text: "hold me now" };

  it("takes the median per word across observations", () => {
    const mk = (starts: number[]) => ({
      words: ["hold", "me", "now"].map((text, i) => ({
        text,
        start_ms: starts[i],
        end_ms: starts[i] + 400,
      })),
      confidence: 0.8,
    });
    const merged = mergeLineObservations(line, [
      mk([1000, 1900, 2900]),
      mk([1100, 2000, 3000]),
      mk([1300, 2100, 3400]),
    ]);
    expect(merged).not.toBeNull();
    expect(merged!.map((w) => w.start_ms)).toEqual([1100, 2000, 3000]);
  });

  it("drops observations whose word count does not match the line", () => {
    const bad = { words: [{ text: "hold", start_ms: 1000, end_ms: 1400 }], confidence: 0.9 };
    expect(mergeLineObservations(line, [bad])).toBeNull();
  });

  it("clamps words to sane, monotonic timing inside the line", () => {
    const messy = {
      words: [
        { text: "hold", start_ms: 2000, end_ms: 1500 },
        { text: "me", start_ms: 1500, end_ms: 9000 },
        { text: "now", start_ms: 1400, end_ms: 9999 },
      ],
      confidence: 0.9,
    };
    const merged = mergeLineObservations(line, [messy])!;
    expect(merged[1].start_ms).toBeGreaterThan(merged[0].start_ms);
    expect(merged[2].start_ms).toBeGreaterThan(merged[1].start_ms);
    expect(merged[2].end_ms).toBeLessThanOrEqual(line.end_ms);
    for (const w of merged) expect(w.end_ms).toBeGreaterThan(w.start_ms);
  });
});

describe("runStitchCheck", () => {
  it("does nothing below the coverage threshold", async () => {
    const db = await makeDb();
    const { track, payload } = await makeBaseTrack(db);
    await insertObs(db, track.id, payload.lines[0]);
    await insertObs(db, track.id, payload.lines[1]);
    expect(await runStitchCheck(db, track.id)).toBeNull();
  });

  it("publishes an auto_aligned revision at coverage and serves it", async () => {
    const db = await makeDb();
    const { track, base, payload } = await makeBaseTrack(db);
    // 3 distinct observers on line 0 with different jitter; 1 on lines 1-3.
    await insertObs(db, track.id, payload.lines[0], { jitterMs: 0, fingerprint: "a" });
    await insertObs(db, track.id, payload.lines[0], { jitterMs: 100, fingerprint: "b" });
    await insertObs(db, track.id, payload.lines[0], { jitterMs: 40, fingerprint: "c" });
    await insertObs(db, track.id, payload.lines[1]);
    await insertObs(db, track.id, payload.lines[2]);

    // 3 of 5 lines covered -> required = max(3, ceil(0.6*5)) = 3 → publishes.
    const stitchedId = await runStitchCheck(db, track.id);
    expect(stitchedId).not.toBeNull();
    const [trackRow] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    expect(trackRow.bestRevisionId).toBe(stitchedId);
    expect(stitchedId).not.toBe(base.id);

    const [stitched] = await db.select().from(revisions).where(eq(revisions.id, stitchedId!));
    expect(stitched).toMatchObject({
      source: "auto_aligned",
      tier: "auto_aligned",
      status: "active",
      parentRevisionId: base.id,
      submitterFingerprint: STITCH_FINGERPRINT,
    });
    const stitchedPayload = validatePayload(JSON.parse(stitched.payload));
    expect(stitchedPayload.meta.has_word_timing).toBe(true);
    // line 0 word start = median of jitters 0/100/40 -> +40
    expect(stitchedPayload.lines[0].words![0].start_ms).toBe(payload.lines[0].start_ms + 40);
    // uncovered lines stay line-level
    expect(stitchedPayload.lines[4].words).toBeUndefined();
  });

  it("re-stitches only on meaningful coverage improvement, after the debounce", async () => {
    const db = await makeDb();
    const { track, payload } = await makeBaseTrack(db);
    for (const i of [0, 1, 2]) await insertObs(db, track.id, payload.lines[i]);
    // first run publishes (3 covered)
    const firstId = await runStitchCheck(db, track.id);
    expect(firstId).not.toBeNull();
    const first = await db.select().from(revisions).where(eq(revisions.trackId, track.id));
    expect(first).toHaveLength(2);

    // full coverage reached immediately -> still debounced (too fresh)
    await insertObs(db, track.id, payload.lines[3]);
    await insertObs(db, track.id, payload.lines[4]);
    expect(await runStitchCheck(db, track.id)).toBeNull();

    // age the previous stitch past the debounce window
    const aged = Date.now() - 10 * 60 * 1000;
    await db.update(revisions).set({ createdAt: aged }).where(eq(revisions.id, firstId!));

    // same coverage as the stitch (5) vs previous covered (3): +2 -> re-stitch
    const id = await runStitchCheck(db, track.id);
    expect(id).not.toBeNull();

    // aged again but no further improvement -> null
    await db.update(revisions).set({ createdAt: aged }).where(eq(revisions.id, id!));
    expect(await runStitchCheck(db, track.id)).toBeNull();

    const all = await db.select().from(revisions).where(eq(revisions.trackId, track.id));
    expect(all).toHaveLength(3);
  });

  it("never stitches over human-tier lyrics", async () => {
    const db = await makeDb();
    const { track, payload } = await makeBaseTrack(db, "community");
    for (const line of payload.lines) {
      await insertObs(db, track.id, line);
    }
    expect(await runStitchCheck(db, track.id)).toBeNull();
  });

  it("ignores low-confidence and mismatched observations", async () => {
    const db = await makeDb();
    const { track, payload } = await makeBaseTrack(db);
    for (const line of payload.lines) {
      await insertObs(db, track.id, line, { confidence: 0.1 }); // below MIN_OBSERVATION_CONFIDENCE
    }
    expect(await runStitchCheck(db, track.id)).toBeNull();

    for (const line of payload.lines) {
      await insertObs(db, track.id, line, { wordCount: 1 }); // word count mismatch
    }
    expect(await runStitchCheck(db, track.id)).toBeNull();
  });
});
