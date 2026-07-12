import { formatTimestamp, parseTimestampMs } from "./lrc";
import {
  FormatError,
  Line,
  LyricsPayload,
  TRAILING_DURATION_MS,
  Word,
} from "./types";

const LINE_TAG_START = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

/**
 * Enhanced LRC (A2 extension) -> payload. Each line: a [mm:ss.xx] line tag
 * followed by <mm:ss.xx>-tagged words. Word end_ms = next word tag on the
 * line (a trailing bare tag sets the last word's end); otherwise the line
 * end. Lines without word tags fall back to line-level timing.
 */
export function parseEnhancedLrc(input: string): LyricsPayload {
  const parsed: { start_ms: number; text: string; words: Word[] }[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    const lineTag = line.match(LINE_TAG_START);
    if (!lineTag) continue;

    const lineStart = parseTimestampMs(lineTag[1], lineTag[2], lineTag[3]);
    const rest = line.slice(lineTag[0].length);

    // Split the remainder into (timestamp, text) segments.
    WORD_TAG.lastIndex = 0;
    const segments: { ms: number; text: string }[] = [];
    let match: RegExpExecArray | null;
    let prev: { ms: number; textStart: number } | null = null;
    while ((match = WORD_TAG.exec(rest)) !== null) {
      if (prev) {
        segments.push({
          ms: prev.ms,
          text: rest.slice(prev.textStart, match.index),
        });
      }
      prev = {
        ms: parseTimestampMs(match[1], match[2], match[3]),
        textStart: WORD_TAG.lastIndex,
      };
    }
    if (prev) segments.push({ ms: prev.ms, text: rest.slice(prev.textStart) });

    const words: Word[] = [];
    for (let i = 0; i < segments.length; i++) {
      const text = segments[i].text.trim();
      if (text === "") continue; // trailing bare tag: only closes the previous word
      const end =
        i + 1 < segments.length
          ? segments[i + 1].ms
          : segments[i].ms + TRAILING_DURATION_MS;
      words.push({ text, start_ms: segments[i].ms, end_ms: end });
    }
    // A trailing bare tag (empty text) marks the true end of the last word.
    if (segments.length >= 2 && segments[segments.length - 1].text.trim() === "" && words.length > 0) {
      words[words.length - 1].end_ms = segments[segments.length - 1].ms;
    }

    parsed.push({
      start_ms: lineStart,
      text: words.length > 0 ? words.map((w) => w.text).join(" ") : rest.trim(),
      words,
    });
  }

  if (parsed.length === 0) {
    throw new FormatError("No timestamped lines found in Enhanced LRC input");
  }

  parsed.sort((a, b) => a.start_ms - b.start_ms);

  let anyWords = false;
  const lines: Line[] = parsed.map((l, i) => {
    const nextStart =
      i + 1 < parsed.length ? parsed[i + 1].start_ms : l.start_ms + TRAILING_DURATION_MS;
    let end_ms = nextStart;
    if (l.words.length > 0) {
      anyWords = true;
      // If the last word's end was defaulted, cap it at the line end.
      const last = l.words[l.words.length - 1];
      if (last.end_ms > nextStart) last.end_ms = nextStart;
      end_ms = Math.max(nextStart, last.end_ms);
    }
    const line: Line = { start_ms: l.start_ms, end_ms, singer: null, text: l.text };
    if (l.words.length > 0) line.words = l.words;
    return line;
  });

  return {
    format_version: 1,
    lines,
    meta: { language: null, has_word_timing: anyWords, countdown_lines: [] },
  };
}

/**
 * Payload -> Enhanced LRC. Lines with word timing get <> word tags plus a
 * trailing bare tag closing the last word; lines without stay plain.
 */
export function serializeEnhancedLrc(payload: LyricsPayload): string {
  return payload.lines
    .map((line) => {
      const lineTag = `[${formatTimestamp(line.start_ms)}]`;
      if (!line.words || line.words.length === 0) return `${lineTag}${line.text}`;
      const body = line.words
        .map((w) => `<${formatTimestamp(w.start_ms)}>${w.text}`)
        .join(" ");
      const closing = `<${formatTimestamp(line.words[line.words.length - 1].end_ms)}>`;
      return `${lineTag}${body} ${closing}`;
    })
    .join("\n");
}
