import type { Db } from "./db/client";
import { getActiveChordChart, getTakenDownChordChart, insertChordChart } from "./db/queries";
import { FormatError, type ChordChart } from "./formats";

export type ChordImportResult =
  | { ok: true; chartId: number; deduped: boolean }
  | { ok: false; code: "taken_down" };

/**
 * Import a machine-detected chord chart for an existing track. Shared by the
 * worker's /complete route (chords ride along with an alignment) and the
 * standalone /api/worker/chords backfill route — one import path for both,
 * mirroring importAlignedPayload.
 *
 * Import is strict where the schema is permissive: an empty chart validates
 * (the takedown tombstone needs that) but must never be IMPORTED — an
 * analysis that found no chords has failed, whatever its exit code said.
 */
export async function importChordChart(
  db: Db,
  input: {
    trackId: number;
    payload: ChordChart;
    submitterFingerprint: string;
    derivedFromVideoKey?: string | null;
  }
): Promise<ChordImportResult> {
  if (input.payload.segments.length === 0) {
    throw new FormatError("Chord chart has no segments - refusing to import");
  }

  // A takedown is a legal decision, not a quality call: while any chart for
  // this track is taken_down, re-uploads are refused rather than allowed to
  // paper over it. (The lyric equivalent is enforced socially by moderation;
  // charts are machine-produced and WOULD silently reappear on re-analysis.)
  if (await getTakenDownChordChart(db, input.trackId)) {
    return { ok: false, code: "taken_down" };
  }

  // Byte-identical re-upload (a re-run of the same model on the same audio)
  // adds no information; answer with the existing row.
  const serialized = JSON.stringify(input.payload);
  const current = await getActiveChordChart(db, input.trackId);
  if (current && current.payload === serialized) {
    return { ok: true, chartId: current.id, deduped: true };
  }

  const created = await insertChordChart(db, {
    trackId: input.trackId,
    payload: serialized,
    submitterFingerprint: input.submitterFingerprint,
    derivedFromVideoKey: input.derivedFromVideoKey ?? null,
  });
  return { ok: true, chartId: created.id, deduped: false };
}
