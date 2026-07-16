// Validation and snapshot helpers for lyric comments (line-range anchored,
// see lyricComments in lib/db/schema.ts). Pure — safe on server and client.
import type { LyricsPayload } from "./formats/types";

/** Cap on how many lines one comment may span (blocks whole-song highlights). */
export const MAX_COMMENT_RANGE_LINES = 10;
export const MAX_COMMENT_BODY_CHARS = 2000;

/** Placeholder used for instrumental/empty lines in quotes and rendering. */
export const INSTRUMENTAL_MARK = "♪";

/** Returns null when the range is valid, else a human-readable problem. */
export function validateLineRange(
  startLine: number,
  endLine: number,
  lineCount: number
): string | null {
  if (startLine > endLine) return "start_line must be <= end_line";
  if (lineCount <= 0) return "Track has no lyric lines";
  if (endLine >= lineCount) return "Line range is out of bounds";
  if (endLine - startLine + 1 > MAX_COMMENT_RANGE_LINES) {
    return `A comment can cover at most ${MAX_COMMENT_RANGE_LINES} lines`;
  }
  return null;
}

/** "\n"-joined text of lines[start..end]; empty lines contribute the ♪ mark. */
export function quoteForRange(
  payload: LyricsPayload,
  startLine: number,
  endLine: number
): string {
  return payload.lines
    .slice(startLine, endLine + 1)
    .map((l) => l.text.trim() || INSTRUMENTAL_MARK)
    .join("\n");
}
