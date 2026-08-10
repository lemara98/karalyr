import type { ChordSegment } from "./formats/chords";

/**
 * Chord segment -> the symbol a musician reads ("Bbmaj7/D", "F#m", "Gsus4").
 *
 * TypeScript twin of Instrufilt's chordName(): root + "m" when quality is 1
 * + ext verbatim + "/bass". Accidentals follow the chart's estimated key —
 * Bb in F major, never A# — via the same circle-of-fifths rule the whole
 * family uses.
 */

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Circle-of-fifths position per MAJOR key tonic; negative = flat side. */
const FIFTHS_MAJOR: Record<number, number> = {
  0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6,
  1: -5, 8: -4, 3: -3, 10: -2, 5: -1,
};

export function keyUsesFlats(keyPc: number | null, keyMode: "maj" | "min" | null): boolean {
  if (keyPc == null) return false;
  const majorPc = keyMode === "min" ? (keyPc + 3) % 12 : keyPc;
  return (FIFTHS_MAJOR[majorPc] ?? 0) < 0;
}

export function pitchName(pc: number, useFlats: boolean): string {
  return (useFlats ? FLAT : SHARP)[((pc % 12) + 12) % 12];
}

export function chordLabel(
  seg: Pick<ChordSegment, "root_pc" | "quality" | "ext" | "bass_pc">,
  useFlats: boolean
): string {
  let label = pitchName(seg.root_pc, useFlats) + (seg.quality === 1 ? "m" : "") + (seg.ext ?? "");
  if (seg.bass_pc != null && seg.bass_pc % 12 !== seg.root_pc % 12) {
    label += "/" + pitchName(seg.bass_pc, useFlats);
  }
  return label;
}
