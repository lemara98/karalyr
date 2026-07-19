import { parseEnhancedLrc, serializeEnhancedLrc } from "./enhanced-lrc";
import { parseLrc, serializeLrc } from "./lrc";
import { parseUltraStar } from "./ultrastar";
import { FormatError, LyricsPayload, payloadSchema } from "./types";

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

/** The string served as LRCLIB-compatible syncedLyrics. */
export function payloadToSyncedLyrics(payload: LyricsPayload): string {
  return payload.meta.has_word_timing
    ? serializeEnhancedLrc(payload)
    : serializeLrc(payload);
}
