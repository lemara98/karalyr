// Tolerant "any lyrics text → plain sung lines" reducer. Unlike parseLrc
// (which throws on untimed input), this accepts plain text, LRC, and
// enhanced LRC alike. It must stay in lockstep with worker/align.py's
// load_lyric_lines (same TAG_RE, same whitespace collapse) so the text
// stored on a sync job is byte-for-byte what the aligner reads.
const TAG_RE = /\[[^\]]*\]|<[^>]*>/g;

export function stripToPlainLines(raw: string): string {
  const lines: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const text = rawLine.replace(TAG_RE, "").replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
  }
  return lines.join("\n");
}
