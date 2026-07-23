import { parseEnhancedLrc, serializeEnhancedLrc } from "./enhanced-lrc";
import { parseLrc, serializeLrc } from "./lrc";
import { parseUltraStar } from "./ultrastar";
import { FormatError, LyricsPayload, payloadSchema, Word } from "./types";

export * from "./types";
export { parseLrc, serializeLrc, formatTimestamp, parseTimestampMs } from "./lrc";
export { parseEnhancedLrc, serializeEnhancedLrc } from "./enhanced-lrc";
export { parseUltraStar } from "./ultrastar";
export { stripToPlainLines } from "./plain";

export type ImportFormat = "lrc" | "enhanced_lrc" | "ultrastar";

export function detectFormat(raw: string): ImportFormat {
  if (/^#(TITLE|ARTIST|BPM|MP3|AUDIO|GAP):/im.test(raw) || /^[:*FRG]\s+-?\d+\s+\d+\s+-?\d+\s/m.test(raw)) {
    return "ultrastar";
  }
  if (/<\d{1,3}:\d{1,2}([.:]\d{1,3})?>/.test(raw)) {
    return "enhanced_lrc";
  }
  return "lrc";
}

export function parseByFormat(raw: string, format: ImportFormat): LyricsPayload {
  switch (format) {
    case "lrc":
      return parseLrc(raw);
    case "enhanced_lrc":
      return parseEnhancedLrc(raw);
    case "ultrastar":
      return parseUltraStar(raw);
    default:
      throw new FormatError(`Unknown format: ${format satisfies never}`);
  }
}

/** Validate an arbitrary object as a LyricsPayload; throws FormatError. */
export function validatePayload(value: unknown): LyricsPayload {
  const result = payloadSchema.safeParse(value);
  if (!result.success) {
    throw new FormatError(`Invalid lyrics payload: ${result.error.issues[0]?.message ?? "unknown error"}`);
  }
  return result.data;
}

/**
 * The string served as LRCLIB-compatible syncedLyrics. Word-level by default
 * (external clients expect one tag per word); pass `syllables: true` for the
 * full-fidelity form the Studio round-trips.
 */
export function payloadToSyncedLyrics(
  payload: LyricsPayload,
  opts: { syllables?: boolean } = {}
): string {
  return payload.meta.has_word_timing
    ? serializeEnhancedLrc(payload, opts)
    : serializeLrc(payload);
}

/**
 * 0-100 sweep position for the word being sung at `timeMs`. With syllable
 * timing the fill follows the measured syllable boundaries (weighted by
 * text length, which tracks rendered width); otherwise it wipes linearly
 * across the word's own start→end window.
 */
export function wordFillPercent(w: Word, timeMs: number): number {
  const syls = w.syllables;
  if (!syls || syls.length < 2) {
    if (w.end_ms <= w.start_ms) return 100;
    return Math.round(Math.min(100, Math.max(0, (100 * (timeMs - w.start_ms)) / (w.end_ms - w.start_ms))));
  }
  const total = syls.reduce((n, s) => n + s.text.length, 0) || 1;
  let done = 0;
  for (const s of syls) {
    if (timeMs >= s.end_ms) {
      done += s.text.length;
      continue;
    }
    if (timeMs >= s.start_ms && s.end_ms > s.start_ms) {
      done += (s.text.length * (timeMs - s.start_ms)) / (s.end_ms - s.start_ms);
    }
    break;
  }
  return Math.round(Math.min(100, (100 * done) / total));
}
