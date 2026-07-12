import {
  FormatError,
  LyricsPayload,
  TRAILING_DURATION_MS,
} from "./types";

const LINE_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[(ar|ti|al|by|offset|la|lang|length|re|ve):(.*)\]$/i;

export function parseTimestampMs(min: string, sec: string, frac?: string): number {
  const minutes = parseInt(min, 10);
  const seconds = parseInt(sec, 10);
  // Fractional part: 2 digits = centiseconds, 3 digits = milliseconds.
  let ms = 0;
  if (frac !== undefined) {
    ms = frac.length === 3 ? parseInt(frac, 10) : parseInt(frac.padEnd(2, "0"), 10) * 10;
  }
  return minutes * 60_000 + seconds * 1000 + ms;
}

export function formatTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const centis = Math.floor((clamped % 1000) / 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
}

/**
 * Plain LRC -> payload. Supports multiple line tags per source line and
 * ignores metadata tags. Line end_ms = next line's start (last line gets
 * TRAILING_DURATION_MS).
 */
export function parseLrc(input: string): LyricsPayload {
  const stamped: { start_ms: number; text: string }[] = [];
  let language: string | null = null;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    const metaMatch = line.match(META_TAG);
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase();
      if (key === "la" || key === "lang") language = metaMatch[2].trim() || null;
      continue;
    }

    LINE_TAG.lastIndex = 0;
    const tags: number[] = [];
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = LINE_TAG.exec(line)) !== null) {
      // Only consume tags at the start of the line (allowing repeats).
      if (match.index !== lastEnd) break;
      tags.push(parseTimestampMs(match[1], match[2], match[3]));
      lastEnd = LINE_TAG.lastIndex;
    }
    if (tags.length === 0) continue;

    const text = line.slice(lastEnd).trim();
    for (const start_ms of tags) stamped.push({ start_ms, text });
  }

  if (stamped.length === 0) {
    throw new FormatError("No timestamped lines found in LRC input");
  }

  stamped.sort((a, b) => a.start_ms - b.start_ms);

  return {
    format_version: 1,
    lines: stamped.map((l, i) => ({
      start_ms: l.start_ms,
      end_ms:
        i + 1 < stamped.length
          ? stamped[i + 1].start_ms
          : l.start_ms + TRAILING_DURATION_MS,
      singer: null,
      text: l.text,
    })),
    meta: { language, has_word_timing: false, countdown_lines: [] },
  };
}

/** Payload -> plain LRC (line tags only, word timing dropped). */
export function serializeLrc(payload: LyricsPayload): string {
  return payload.lines
    .map((line) => `[${formatTimestamp(line.start_ms)}]${line.text}`)
    .join("\n");
}
