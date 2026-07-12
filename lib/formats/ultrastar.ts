import {
  FormatError,
  Line,
  LyricsPayload,
  Word,
} from "./types";

type Singer = "P1" | "P2" | "BOTH";

/**
 * UltraStar .txt -> payload.
 *
 * Timing: UltraStar "beats" are quarter-beats of #BPM, so
 *   ms = GAP + beat * (60000 / (BPM * 4)) = GAP + beat * 15000 / BPM
 *
 * Note lines look like `: 0 4 12 Hel` (`:` normal, `*` golden, `F` freestyle,
 * `R` rap, `G` rap-golden — all sung syllables for our purposes). `- <beat>`
 * ends a line. `P1`/`P2`/`P3` switch the active singer (P3 = both, per the
 * classic duet convention). Adjacent syllables merge into one word unless the
 * next syllable's text starts with a space (UltraStar encodes word breaks as
 * leading spaces).
 */
export function parseUltraStar(input: string): LyricsPayload {
  let bpm: number | null = null;
  let gapMs = 0;
  let language: string | null = null;
  let isDuet = false;

  type Syllable = { beat: number; lengthBeats: number; text: string };
  type PendingLine = { singer: Singer | null; syllables: Syllable[] };

  const finishedLines: { singer: Singer | null; syllables: Syllable[] }[] = [];
  let current: PendingLine = { singer: null, syllables: [] };
  let activeSinger: Singer | null = null;

  const flushLine = () => {
    if (current.syllables.length > 0) {
      finishedLines.push(current);
    }
    current = { singer: activeSinger, syllables: [] };
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, "").trimEnd();
    if (line.trim() === "") continue;

    if (line.startsWith("#")) {
      const sep = line.indexOf(":");
      if (sep === -1) continue;
      const key = line.slice(1, sep).trim().toUpperCase();
      const value = line.slice(sep + 1).trim();
      if (key === "BPM") {
        bpm = parseFloat(value.replace(",", "."));
      } else if (key === "GAP") {
        gapMs = parseFloat(value.replace(",", ".")) || 0;
      } else if (key === "LANGUAGE") {
        language = value || null;
      }
      continue;
    }

    if (line === "E") break;

    const singerMatch = line.trim().match(/^P\s*(\d)$/i);
    if (singerMatch) {
      flushLine();
      isDuet = true;
      const n = singerMatch[1];
      activeSinger = n === "1" ? "P1" : n === "2" ? "P2" : "BOTH";
      current.singer = activeSinger;
      continue;
    }

    if (line.startsWith("-")) {
      flushLine();
      continue;
    }

    const noteMatch = line.match(/^([:*FRG])\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s(.*)$/);
    if (noteMatch) {
      current.syllables.push({
        beat: parseInt(noteMatch[2], 10),
        lengthBeats: parseInt(noteMatch[3], 10),
        text: noteMatch[5],
      });
      if (current.singer === null) current.singer = activeSinger;
    }
  }
  flushLine();

  if (bpm === null || !(bpm > 0)) {
    throw new FormatError("UltraStar input is missing a valid #BPM header");
  }
  if (finishedLines.length === 0) {
    throw new FormatError("No note lines found in UltraStar input");
  }

  const msPerBeat = 15000 / bpm;
  const toMs = (beat: number) => Math.round(gapMs + beat * msPerBeat);

  const lines: Line[] = finishedLines.map((fl) => {
    // Merge syllables into words: a syllable starting with a space (or the
    // first syllable) starts a new word; others append to the previous word.
    const words: Word[] = [];
    for (const syl of fl.syllables) {
      const startsWord = words.length === 0 || syl.text.startsWith(" ");
      const text = syl.text.trim();
      const start = toMs(syl.beat);
      const end = toMs(syl.beat + syl.lengthBeats);
      if (startsWord || words.length === 0) {
        if (text !== "") words.push({ text, start_ms: start, end_ms: end });
      } else {
        const prev = words[words.length - 1];
        prev.text += text;
        prev.end_ms = end;
      }
    }
    const first = fl.syllables[0];
    const last = fl.syllables[fl.syllables.length - 1];
    return {
      start_ms: toMs(first.beat),
      end_ms: toMs(last.beat + last.lengthBeats),
      singer: isDuet ? fl.singer : null,
      text: words.map((w) => w.text).join(" "),
      words,
    };
  });

  lines.sort((a, b) => a.start_ms - b.start_ms);

  return {
    format_version: 1,
    lines,
    meta: { language, has_word_timing: true, countdown_lines: [] },
  };
}
