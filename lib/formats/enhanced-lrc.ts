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
 * followed by <mm:ss.xx>-tagged words. Word end_ms = next tag on the line
 * (a trailing bare tag sets the last word's end); otherwise the line end.
 * Lines without word tags fall back to line-level timing.
 *
 * Syllables: a tag with no whitespace before it continues the same word
 * (`<t1>he<t2>llo` is one word "hello" with two timed syllables), mirroring
 * how UltraStar marks word breaks with spaces. Words that split this way
 * carry their pieces in `word.syllables`.
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

    // Group segments into words. A segment continues the previous word when
    // that word's last segment did not end in whitespace; a bare/whitespace
    // segment closes the open word (this is the classic trailing end tag).
    type Grouped = { parts: { ms: number; text: string }[]; end?: number };
    const grouped: Grouped[] = [];
    let open = false;
    for (const seg of segments) {
      const text = seg.text.trim();
      if (text === "") {
        const last = grouped[grouped.length - 1];
        if (last && last.end === undefined) last.end = seg.ms;
        open = false;
        continue;
      }
      if (open && grouped.length > 0) {
        grouped[grouped.length - 1].parts.push({ ms: seg.ms, text });
      } else {
        const last = grouped[grouped.length - 1];
        if (last && last.end === undefined) last.end = seg.ms;
        grouped.push({ parts: [{ ms: seg.ms, text }] });
      }
      open = !/\s$/.test(seg.text);
    }

    const words: Word[] = grouped.map((g, k) => {
      const start = g.parts[0].ms;
      const end =
        g.end ??
        (k + 1 < grouped.length ? grouped[k + 1].parts[0].ms : start + TRAILING_DURATION_MS);
      const word: Word = { text: g.parts.map((p) => p.text).join(""), start_ms: start, end_ms: end };
      if (g.parts.length >= 2) {
        word.syllables = g.parts.map((p, i) => ({
          text: p.text,
          start_ms: p.ms,
          end_ms: i + 1 < g.parts.length ? g.parts[i + 1].ms : end,
        }));
      }
      return word;
    });

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
      if (last.syllables) {
        for (const syl of last.syllables) {
          if (syl.end_ms > last.end_ms) syl.end_ms = last.end_ms;
          if (syl.start_ms > last.end_ms) syl.start_ms = last.end_ms;
        }
      }
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
 *
 * `syllables: true` additionally writes sub-word tags with no separating
 * space (`<t1>he<t2>llo`), which parseEnhancedLrc round-trips back into
 * word.syllables. Off by default: external LRC consumers expect one tag
 * per word, so the LRCLIB-compatible API and file exports stay word-level.
 */
export function serializeEnhancedLrc(
  payload: LyricsPayload,
  { syllables = false }: { syllables?: boolean } = {}
): string {
  return payload.lines
    .map((line) => {
      const lineTag = `[${formatTimestamp(line.start_ms)}]`;
      if (!line.words || line.words.length === 0) return `${lineTag}${line.text}`;
      const body = line.words
        .map((w) =>
          syllables && w.syllables && w.syllables.length >= 2
            ? w.syllables.map((s) => `<${formatTimestamp(s.start_ms)}>${s.text}`).join("")
            : `<${formatTimestamp(w.start_ms)}>${w.text}`
        )
        .join(" ");
      const closing = `<${formatTimestamp(line.words[line.words.length - 1].end_ms)}>`;
      return `${lineTag}${body} ${closing}`;
    })
    .join("\n");
}
