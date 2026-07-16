// Instrumental-gap detection for the karaoke player: stretches longer than
// GAP_MIN_MS with no timed lyrics get a filling progress bar in LyricsView
// instead of a dead screen. Pure — unit-tested in tests/gaps.test.ts.

export const GAP_MIN_MS = 5000;

export interface GapSegment {
  /** The gap row renders before lines[index]. */
  index: number;
  start: number;
  end: number;
}

/** Gaps strictly longer than minMs: the intro before the first line, and any silence between consecutive lines. */
export function gapSegments(
  lines: { start_ms: number; end_ms: number }[],
  minMs = GAP_MIN_MS
): GapSegment[] {
  const gaps: GapSegment[] = [];
  if (lines.length === 0) return gaps;
  if (lines[0].start_ms > minMs) {
    gaps.push({ index: 0, start: 0, end: lines[0].start_ms });
  }
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i + 1].start_ms - lines[i].end_ms > minMs) {
      gaps.push({ index: i + 1, start: lines[i].end_ms, end: lines[i + 1].start_ms });
    }
  }
  return gaps;
}
