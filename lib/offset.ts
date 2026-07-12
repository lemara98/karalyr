import { LyricsPayload } from "./formats/types";

/**
 * Shift every timestamp in a payload by offsetMs (positive = lyrics appear
 * later). Clamped at 0 so an aggressive negative offset can't produce
 * negative times.
 */
export function applyOffset(payload: LyricsPayload, offsetMs: number): LyricsPayload {
  const shift = (ms: number) => Math.max(0, Math.round(ms + offsetMs));
  return {
    ...payload,
    lines: payload.lines.map((line) => ({
      ...line,
      start_ms: shift(line.start_ms),
      end_ms: shift(line.end_ms),
      words: line.words?.map((w) => ({
        ...w,
        start_ms: shift(w.start_ms),
        end_ms: shift(w.end_ms),
      })),
    })),
  };
}

/** Median of a non-empty number array. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
