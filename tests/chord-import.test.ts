import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { importChordChart } from "@/lib/chord-import";
import { getActiveChordChart, hasActiveChordChart } from "@/lib/db/queries";
import { chordCharts } from "@/lib/db/schema";
import { FormatError, validateChordChart } from "@/lib/formats";
import { makeChordChart, makeDb, makeTrack, sampleChordChart } from "./helpers";

describe("validateChordChart", () => {
  it("accepts the sample chart and strips unknown keys", () => {
    const chart = validateChordChart({ ...sampleChordChart(), extra: "dropped" });
    expect(chart.segments).toHaveLength(4);
    expect("extra" in chart).toBe(false);
  });

  it("accepts empty segments (the tombstone shape)", () => {
    const chart = validateChordChart({ ...sampleChordChart(), segments: [] });
    expect(chart.segments).toHaveLength(0);
  });

  it("rejects out-of-range pitch classes and unknown versions", () => {
    const good = sampleChordChart();
    expect(() =>
      validateChordChart({
        ...good,
        segments: [{ ...good.segments[0], root_pc: 12 }],
      })
    ).toThrow(FormatError);
    expect(() => validateChordChart({ ...good, format_version: 2 })).toThrow(FormatError);
    expect(() => validateChordChart({ ...good, meta: undefined })).toThrow(FormatError);
  });
});

describe("importChordChart", () => {
  it("imports a chart and serves it as the active one", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const result = await importChordChart(db, {
      trackId: track.id,
      payload: sampleChordChart(),
      submitterFingerprint: "system:sync-queue",
      derivedFromVideoKey: "yt:abc123def45",
    });
    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(await hasActiveChordChart(db, track.id)).toBe(true);
    const active = await getActiveChordChart(db, track.id);
    expect(active?.source).toBe("auto_detected");
    expect(active?.tier).toBe("auto_aligned");
    expect(active?.derivedFromVideoKey).toBe("yt:abc123def45");
  });

  it("refuses an empty chart - schema permissive, import strict", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await expect(
      importChordChart(db, {
        trackId: track.id,
        payload: { ...sampleChordChart(), segments: [] },
        submitterFingerprint: "system:sync-queue",
      })
    ).rejects.toThrow(FormatError);
  });

  it("newest active chart wins; older rows stay for the audit trail", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await makeChordChart(db, track.id, { createdAt: 1000 });
    const newer = sampleChordChart(5000);
    const result = await importChordChart(db, {
      trackId: track.id,
      payload: newer,
      submitterFingerprint: "system:chords-backfill",
    });
    expect(result.ok).toBe(true);
    const active = await getActiveChordChart(db, track.id);
    expect(active?.payload).toBe(JSON.stringify(newer));
    expect(await db.select().from(chordCharts).where(eq(chordCharts.trackId, track.id))).toHaveLength(2);
  });

  it("dedupes a byte-identical re-upload onto the existing row", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const payload = sampleChordChart();
    const first = await importChordChart(db, {
      trackId: track.id,
      payload,
      submitterFingerprint: "system:sync-queue",
    });
    const second = await importChordChart(db, {
      trackId: track.id,
      payload,
      submitterFingerprint: "system:chords-backfill",
    });
    expect(second).toMatchObject({ ok: true, deduped: true });
    if (first.ok && second.ok) expect(second.chartId).toBe(first.chartId);
    expect(await db.select().from(chordCharts)).toHaveLength(1);
  });

  it("a taken_down chart blocks re-import", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await makeChordChart(db, track.id, { status: "taken_down" });
    const result = await importChordChart(db, {
      trackId: track.id,
      payload: sampleChordChart(),
      submitterFingerprint: "system:chords-backfill",
    });
    expect(result).toEqual({ ok: false, code: "taken_down" });
    expect(await hasActiveChordChart(db, track.id)).toBe(false);
  });
});
