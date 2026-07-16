import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  lineObservations,
  revisions,
  tracks,
  TIER_RANK,
  type LineObservation,
  type Revision,
} from "./db/schema";
import { insertRevision } from "./db/queries";
import { validatePayload, type Line, type LyricsPayload, type Word } from "./formats";
import { median } from "./offset";

export const STITCH_FINGERPRINT = "system:listen-align";
/** Fraction of (non-empty) base lines that need >=1 valid observation. */
export const STITCH_MIN_COVERAGE = 0.6;
export const STITCH_MIN_LINES = 3;
/** Observation anchors to a base line when start times agree within this. */
export const LINE_MATCH_TOLERANCE_MS = 500;
export const MIN_OBSERVATION_CONFIDENCE = 0.3;
/** A re-stitch must cover at least this many MORE lines than the last one. */
export const RESTITCH_MIN_IMPROVEMENT = 2;
/**
 * Minimum age of the previous stitch before publishing another. Without
 * this, coverage growing line-by-line DURING a playthrough publishes a
 * revision every couple of observations (seen: 7 revisions in one song).
 */
export const RESTITCH_MIN_INTERVAL_MS = 3 * 60 * 1000;

interface ObservedWords {
  words: Word[];
  confidence: number;
}

/**
 * Merge multiple observations of one line into a single word list: keep the
 * observations whose word count matches the line's actual words, then take
 * the median start/end per word position. Word texts come from the base
 * line (canonical). Returns null when no observation fits.
 */
export function mergeLineObservations(
  baseLine: Line,
  observations: ObservedWords[]
): Word[] | null {
  const texts = baseLine.text.split(/\s+/).filter(Boolean);
  if (texts.length === 0) return null;
  const usable = observations.filter((o) => o.words.length === texts.length);
  if (usable.length === 0) return null;

  const words: Word[] = texts.map((text, i) => ({
    text,
    start_ms: median(usable.map((o) => o.words[i].start_ms)),
    end_ms: median(usable.map((o) => o.words[i].end_ms)),
  }));

  // Keep timing sane: monotonic starts, ends after starts, inside the line.
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && words[i].start_ms < words[i - 1].start_ms + 10) {
      words[i].start_ms = words[i - 1].start_ms + 10;
    }
    if (words[i].end_ms <= words[i].start_ms) words[i].end_ms = words[i].start_ms + 10;
    if (i > 0 && words[i - 1].end_ms > words[i].start_ms) {
      words[i - 1].end_ms = words[i].start_ms;
    }
  }
  const last = words[words.length - 1];
  if (last.end_ms > baseLine.end_ms) last.end_ms = Math.max(last.start_ms + 10, baseLine.end_ms);
  return words;
}

function parseObservation(obs: LineObservation): ObservedWords | null {
  try {
    const words = JSON.parse(obs.wordsJson) as Word[];
    if (!Array.isArray(words) || words.length === 0) return null;
    return { words, confidence: obs.confidence };
  } catch {
    return null;
  }
}

/**
 * Try to publish an auto_aligned revision for a track from accumulated line
 * observations. Called after each observation insert. Returns the new
 * revision id, or null when there is nothing to do:
 *
 * - needs a best active revision to anchor lines against
 * - skips when the best revision already has human-grade word timing
 * - needs >= max(3, 60%) of non-empty lines covered by >=1 valid observation
 * - re-stitches over a previous listen-align revision only when coverage
 *   improved by at least RESTITCH_MIN_IMPROVEMENT lines
 */
export async function runStitchCheck(db: Db, trackId: number): Promise<number | null> {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track || track.bestRevisionId == null) return null;
  const [best] = await db.select().from(revisions).where(eq(revisions.id, track.bestRevisionId));
  if (!best || best.status !== "active") return null;

  let basePayload: LyricsPayload;
  try {
    basePayload = validatePayload(JSON.parse(best.payload));
  } catch {
    return null;
  }

  // Only stitch when the result would actually be served: onto a lower-tier
  // (imported) line-level base, or improving our own previous stitch. If a
  // human-tier revision is best, a machine revision would never outrank it —
  // and repeatedly inserting unserved revisions would just pile up noise.
  const isOwnStitch = best.submitterFingerprint === STITCH_FINGERPRINT;
  if (basePayload.meta.has_word_timing && !isOwnStitch) return null;
  if (!isOwnStitch && TIER_RANK[best.tier] >= TIER_RANK.auto_aligned) return null;

  const allObs = await db
    .select()
    .from(lineObservations)
    .where(eq(lineObservations.trackId, trackId));

  const anchorable = basePayload.lines.filter((l) => l.text.trim() !== "");
  if (anchorable.length === 0) return null;

  let covered = 0;
  const mergedByIndex = new Map<number, Word[]>();
  basePayload.lines.forEach((line, index) => {
    if (line.text.trim() === "") return;
    const group = allObs
      .filter(
        (o) =>
          o.confidence >= MIN_OBSERVATION_CONFIDENCE &&
          Math.abs(o.lineStartMs - line.start_ms) <= LINE_MATCH_TOLERANCE_MS
      )
      .map(parseObservation)
      .filter((o): o is ObservedWords => o !== null);
    if (group.length === 0) return;
    const merged = mergeLineObservations(line, group);
    if (merged) {
      mergedByIndex.set(index, merged);
      covered++;
    }
  });

  const required = Math.max(STITCH_MIN_LINES, Math.ceil(anchorable.length * STITCH_MIN_COVERAGE));
  if (covered < required) return null;

  if (isOwnStitch) {
    if (Date.now() - best.createdAt < RESTITCH_MIN_INTERVAL_MS) return null;
    const prevCovered = basePayload.lines.filter((l) => l.words && l.words.length > 0).length;
    if (covered < prevCovered + RESTITCH_MIN_IMPROVEMENT) return null;
  }

  const stitched: LyricsPayload = {
    ...basePayload,
    lines: basePayload.lines.map((line, index) => {
      const words = mergedByIndex.get(index);
      return words ? { ...line, words } : { ...line, words: undefined };
    }),
    meta: { ...basePayload.meta, has_word_timing: true },
  };

  const revision = await insertRevision(db, {
    trackId,
    source: "auto_aligned",
    tier: "auto_aligned",
    payload: stitched,
    parentRevisionId: best.id,
    submitterFingerprint: STITCH_FINGERPRINT,
  });
  return revision.id;
}
