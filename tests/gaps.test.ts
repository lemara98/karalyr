import { describe, expect, it } from "vitest";
import { gapSegments, GAP_MIN_MS } from "@/lib/gaps";
import { samplePayload } from "./helpers";

const line = (start_ms: number, end_ms: number) => ({ start_ms, end_ms });

describe("gapSegments", () => {
  it("returns nothing for empty lines", () => {
    expect(gapSegments([])).toEqual([]);
  });

  it("detects an intro gap longer than the threshold", () => {
    expect(gapSegments([line(21402, 23603), line(24000, 26000)])).toEqual([
      { index: 0, start: 0, end: 21402 },
    ]);
  });

  it("uses a strict threshold — exactly GAP_MIN_MS does not trigger", () => {
    expect(gapSegments([line(GAP_MIN_MS, 8000)])).toEqual([]);
    expect(gapSegments([line(GAP_MIN_MS + 1, 8000)])).toEqual([
      { index: 0, start: 0, end: GAP_MIN_MS + 1 },
    ]);
  });

  it("detects mid-song gaps with correct boundaries", () => {
    const lines = [line(0, 5000), line(6000, 10_000), line(29_700, 32_000)];
    expect(gapSegments(lines)).toEqual([{ index: 2, start: 10_000, end: 29_700 }]);
  });

  it("ignores short breathers and back-to-back lines", () => {
    const lines = [line(0, 5000), line(8400, 10_000), line(10_000, 12_000)];
    expect(gapSegments(lines)).toEqual([]);
  });

  it("handles the sample payload shape (no qualifying gaps)", () => {
    // samplePayload: lines at 1000-3000 and 4000-6000 → intro 1s, gap 1s.
    expect(gapSegments(samplePayload().lines)).toEqual([]);
  });
});
