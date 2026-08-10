import { z } from "zod";
import { FormatError } from "./types";

/**
 * Machine-detected chord charts — the payload stored in chord_charts.payload
 * and served by GET /api/chords.
 *
 * Same conventions as the lyrics payload: integer milliseconds, top-level
 * format_version, meta object. Segments are sorted and non-overlapping;
 * no-chord (Harte "N") stretches are simply the gaps between segments.
 *
 * `label` keeps the raw Harte symbol (after key-aware enharmonic respelling,
 * "Bb:maj7/3" style) so future consumers aren't limited to the parsed fields.
 * The parsed fields use the convention Instrufilt renders directly:
 * root_pc/bass_pc are pitch classes 0-11 (C = 0), quality 1 means the symbol
 * takes a lowercase "m", ext is whatever follows ("7", "maj7", "sus4", ...).
 */
export const chordSegmentSchema = z.object({
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  label: z.string().min(1),
  root_pc: z.number().int().min(0).max(11),
  quality: z.union([z.literal(0), z.literal(1)]),
  ext: z.string().optional(),
  bass_pc: z.number().int().min(0).max(11).optional(),
  /** Mean posterior over the segment, 0-1. Machine estimates are honest here
   * — clients are expected to style low-confidence chords differently. */
  confidence: z.number().min(0).max(1),
});

export const chordChartSchema = z.object({
  format_version: z.literal(1),
  // No .min(): the takedown tombstone is an empty chart, exactly like the
  // lyric tombstone's empty lines. The IMPORT path is what refuses empties.
  segments: z.array(chordSegmentSchema),
  meta: z.object({
    /** Analysis backend, e.g. "lv-chordia-ensemble". */
    model: z.string(),
    /** The model's chord dictionary, e.g. "submission". */
    dict: z.string(),
    key_pc: z.number().int().min(0).max(11).nullable(),
    key_mode: z.union([z.literal("maj"), z.literal("min"), z.null()]),
    key_confidence: z.number().min(0).max(1).optional(),
    /** What audio was analyzed. Original mix only for now — models are
     * trained on full mixes, and stems measurably underperform. */
    analyzed_from: z.enum(["original_mix"]),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type ChordSegment = z.infer<typeof chordSegmentSchema>;
export type ChordChart = z.infer<typeof chordChartSchema>;

/** Validate an arbitrary object as a ChordChart; throws FormatError. */
export function validateChordChart(value: unknown): ChordChart {
  const result = chordChartSchema.safeParse(value);
  if (!result.success) {
    throw new FormatError(
      `Invalid chord chart: ${result.error.issues[0]?.message ?? "unknown error"}`
    );
  }
  return result.data;
}
