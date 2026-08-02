import type { Line } from "./formats/types";

/**
 * The literal separator that belongs AFTER each word of a line, derived from
 * the line's own text. Latin lyrics get their spaces back; Chinese char-words
 * and Thai get "" instead of the space the renderer used to hardcode between
 * word spans.
 *
 * Words are located sequentially in `line.text`; when they don't tile (edited
 * text drifted from the word list) every separator falls back to a single
 * space - exactly the old rendering.
 */
export function wordSeparators(line: Line): string[] {
  const words = line.words;
  if (!words || words.length === 0) return [];
  const fallback = words.map((_, i) => (i < words.length - 1 ? " " : ""));
  const text = line.text || "";
  if (!text) return fallback;

  const seps: string[] = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const idx = text.indexOf(words[i].text, cursor);
    if (idx === -1) return fallback;
    const end = idx + words[i].text.length;
    if (i > 0) seps[i - 1] = text.slice(cursor, idx);
    cursor = end;
  }
  seps[words.length - 1] = "";
  return seps;
}
