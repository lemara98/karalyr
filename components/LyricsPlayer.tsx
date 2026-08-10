"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { LyricsPayload } from "@/lib/formats/types";
import type { ChordChart } from "@/lib/formats/chords";
import { wordFillPercent } from "@/lib/formats";
import { gapSegments } from "@/lib/gaps";
import { chordLabel, keyUsesFlats } from "@/lib/chord-label";
import { wordSeparators } from "@/lib/word-separators";

/**
 * Highlights fire this much ahead of the playback clock. Compensates two
 * constant lags: the MMS/CTC aligner marks word onsets 1-3 frames (20-60ms)
 * after the true acoustic onset, and the rAF-driven state paints one frame
 * (~17ms) behind the audio. Applied only while playing - paused scrubbing
 * and seeks stay exact.
 */
export const LYRIC_LEAD_MS = 50;

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Anything that can drive the lyric highlight: the simulator below, or a
 * real media clock (see components/YouTubeLyricsPlayer.tsx).
 */
export interface PlaybackClock {
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  timeMs: number;
  seek: (ms: number) => void;
}

/** Simple simulator clock: requestAnimationFrame, no audio. */
export function useSimulatorClock(durationMs: number) {
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const anchor = useRef({ wallClock: 0, timeMs: 0 });
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    anchor.current = { wallClock: performance.now(), timeMs };
    const tick = () => {
      const next = anchor.current.timeMs + (performance.now() - anchor.current.wallClock);
      if (next >= durationMs) {
        setTimeMs(durationMs);
        setPlaying(false);
        return;
      }
      setTimeMs(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, durationMs]);

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(ms, durationMs));
    anchor.current = { wallClock: performance.now(), timeMs: clamped };
    setTimeMs(clamped);
  }, [durationMs]);

  return { playing, setPlaying, timeMs, seek };
}

export function TransportBar({
  playing,
  setPlaying,
  timeMs,
  seek,
  durationMs,
}: PlaybackClock & { durationMs: number }) {
  return (
    <div className="flex items-center gap-3.5">
      <button onClick={() => setPlaying(!playing)} className="btn btn-primary btn-sm w-20">
        {playing ? "Pause" : "Play"}
      </button>
      <span
        className="w-12 text-right text-[13px] text-[color:var(--color-text-dim)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {fmt(timeMs)}
      </span>
      <input
        type="range"
        min={0}
        max={durationMs}
        value={timeMs}
        onChange={(e) => seek(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span
        className="w-12 text-[13px] text-[color:var(--color-text-dim)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {fmt(durationMs)}
      </span>
    </div>
  );
}

export const SINGER_STYLES: Record<string, string> = {
  P1: "border-[color:color-mix(in_srgb,var(--klr-a)_45%,transparent)] text-[color:var(--klr-a)]",
  P2: "border-[color:color-mix(in_srgb,var(--klr-b)_45%,transparent)] text-[color:var(--klr-b)]",
  BOTH: "border-white/25 text-[color:var(--color-text-muted)]",
};

/**
 * Transport + scrolling highlighted lyrics, driven by any PlaybackClock.
 * `fill` lets the card stretch to its grid cell at lg+ (side-by-side with
 * the video); default keeps the standalone max-h-96 behavior.
 */
export function LyricsView({
  payload,
  clock,
  durationMs,
  captionLead,
  fill = false,
  chordChart = null,
}: {
  payload: LyricsPayload;
  clock: PlaybackClock;
  durationMs: number;
  captionLead: string;
  fill?: boolean;
  /** Machine-detected chart from chord_charts (null = no chords for the track). */
  chordChart?: ChordChart | null;
}) {
  // The transport bar shows the real clock; every highlight below reads the
  // led time so words light up when they are actually heard.
  const timeMs = clock.playing ? clock.timeMs + LYRIC_LEAD_MS : clock.timeMs;
  const activeRef = useRef<HTMLElement | null>(null);
  const linesRef = useRef<HTMLDivElement | null>(null);

  // Focus mode (from the Karafilt side panel): show three lines at a time
  // and swap pages when the active line crosses a boundary. Persisted.
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    try {
      setFocus(localStorage.getItem("klr-focus") === "1");
    } catch {
      // storage unavailable - keep default
    }
  }, []);
  const toggleFocus = useCallback(() => {
    setFocus((f) => {
      try {
        localStorage.setItem("klr-focus", f ? "0" : "1");
      } catch {
        // storage unavailable - state still toggles for this session
      }
      return !f;
    });
  }, []);

  // Chords: off by a persisted toggle, and gone entirely when the track has
  // no chart. Labels are precomputed once per chart (key-aware spelling);
  // per-line grouping puts each chord above the line it sounds under, and
  // whatever falls before the first line or between verses is carried by the
  // current-chord badge in the header row.
  const [showChords, setShowChords] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("klr-chords") === "0") setShowChords(false);
    } catch {
      // storage unavailable - keep default
    }
  }, []);
  const toggleChords = useCallback(() => {
    setShowChords((c) => {
      try {
        localStorage.setItem("klr-chords", c ? "0" : "1");
      } catch {
        // storage unavailable - state still toggles for this session
      }
      return !c;
    });
  }, []);

  const chordSegs = useMemo(() => {
    if (!chordChart) return [];
    const useFlats = keyUsesFlats(chordChart.meta.key_pc, chordChart.meta.key_mode);
    return chordChart.segments.map((s) => ({ ...s, display: chordLabel(s, useFlats) }));
  }, [chordChart]);

  // Chord index per line: every chord whose onset falls while the line is
  // actually sounding (a short tail forgives aligner slack). Chords with no
  // line under them — intros, solos between verses, outros — belong to no
  // line: piling a 30s solo's chords above the preceding lyric would inflate
  // it in both scroll and focus modes, and the header badge already carries
  // them while they sound.
  const chordsByLine = useMemo(() => {
    const byLine = new Map<number, typeof chordSegs>();
    if (!chordSegs.length || !payload.lines.length) return byLine;
    const TAIL_MS = 1500;
    for (const seg of chordSegs) {
      let idx = -1;
      for (let i = 0; i < payload.lines.length; i++) {
        if (payload.lines[i].start_ms <= seg.start_ms) idx = i;
        else break;
      }
      if (idx < 0) continue;
      if (seg.start_ms > payload.lines[idx].end_ms + TAIL_MS) continue;
      const bucket = byLine.get(idx);
      if (bucket) bucket.push(seg);
      else byLine.set(idx, [seg]);
    }
    return byLine;
  }, [chordSegs, payload]);

  const currentChord =
    showChords && chordSegs.length
      ? chordSegs.find((s) => timeMs >= s.start_ms && timeMs < s.end_ms) ?? null
      : null;

  const gaps = useMemo(() => gapSegments(payload.lines), [payload]);
  // Per-line separators between word spans, derived from the line text once
  // per payload (this render runs every frame): spaces for Latin, "" for
  // Chinese char-words and other unspaced scripts.
  const lineSeps = useMemo(() => payload.lines.map(wordSeparators), [payload]);
  const activeGap = gaps.find((g) => timeMs >= g.start && timeMs < g.end) ?? null;

  // Count-in: the bar FILLS toward the downbeat while the number counts the
  // seconds left. The overlay eases out between 2s and 1s remaining - fully
  // gone at 1s, when the upcoming text takes the stage (activeGap itself
  // runs to the true line start). Opacity is clock-driven per frame, so no
  // CSS transition (it would retarget every frame and stutter).
  const countinVisible = activeGap !== null && activeGap.end - timeMs > 1000;
  const countinOpacity = (() => {
    if (!activeGap) return 0;
    const entry = Math.min(1, (timeMs - activeGap.start) / 450);
    const linear = Math.min(1, Math.max(0, (activeGap.end - timeMs - 1000) / 1000));
    const exit = linear * linear * (3 - 2 * linear); // smoothstep - gentle ends
    return Math.min(entry, exit);
  })();

  // While the count-in is up, no line is active. In the gap's final second
  // the UPCOMING line takes the stage in "get ready" state - lit, every word
  // still dim, the wipe starting exactly on the beat. (In focus mode this is
  // also what swaps the upcoming page in.)
  const activeIndex = activeGap
    ? countinVisible
      ? -1
      : activeGap.index
    : payload.lines.findIndex(
        (l, i) =>
          timeMs >= l.start_ms &&
          (timeMs < l.end_ms || (payload.lines[i + 1] && timeMs < payload.lines[i + 1].start_ms))
      );
  const countinPct = activeGap
    ? Math.min(100, Math.max(0, ((timeMs - activeGap.start) / (activeGap.end - activeGap.start)) * 100))
    : 0;
  const countinSeconds = activeGap ? Math.max(1, Math.ceil((activeGap.end - timeMs) / 1000)) : 0;

  // Focus pages are chunks of up to 3 lines that never straddle a gap:
  // a verse after an instrumental break always starts a fresh page, so the
  // upcoming section is never visible under the count-in's lines.
  const pageOfLine = useMemo(() => {
    const breaks = new Set(gaps.map((g) => g.index));
    const pages = new Array<number>(payload.lines.length);
    let page = -1;
    let linesInPage = 0;
    for (let i = 0; i < payload.lines.length; i++) {
      if (i === 0 || breaks.has(i) || linesInPage === 3) {
        page++;
        linesInPage = 0;
      }
      pages[i] = page;
      linesInPage++;
    }
    return pages;
  }, [payload, gaps]);

  const page = focus && activeIndex >= 0 ? pageOfLine[activeIndex] : -1;

  useEffect(() => {
    // Focus mode swaps pages instead of scrolling.
    if (focus) return;
    const el = activeRef.current;
    const box = linesRef.current;
    if (!el || !box) return;
    // Scroll ONLY the lyrics box - scrollIntoView would also scroll every
    // ancestor including the page, yanking the reader back to the card.
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTo({
      top: box.scrollTop + delta - box.clientHeight / 2 + el.clientHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex, activeGap, focus]);

  return (
    <div className={fill ? "flex flex-col gap-4 lg:h-full" : "space-y-4"}>
      <div className="flex items-center gap-3.5">
        <div className="min-w-0 flex-1">
          <TransportBar {...clock} durationMs={durationMs} />
        </div>
        {/* The current chord rides the header so it stays visible through
            intros and solos, where there is no lyric line to hang it on.
            Mounted whenever the lane is on (a dot during no-chord stretches)
            with a reserved min width — a badge that appears/disappears and
            changes width per chord would resize the flex-1 seek slider under
            the pointer at every chord boundary. */}
        {showChords && chordSegs.length > 0 && (
          <span
            className="min-w-16 flex-none rounded-md border border-[color:color-mix(in_srgb,var(--klr-a)_45%,transparent)] px-2 py-0.5 text-center text-[13px] font-bold text-[color:var(--klr-a)]"
            style={{ fontFamily: "var(--font-mono)" }}
            title="Detected chord playing now"
          >
            {currentChord ? currentChord.display : "·"}
          </span>
        )}
        {chordSegs.length > 0 && (
          <button
            onClick={toggleChords}
            aria-pressed={showChords}
            title="Show machine-detected chords above the lyrics"
            className={`btn btn-sm flex-none ${showChords ? "btn-primary" : "btn-secondary"}`}
          >
            Chords
          </button>
        )}
        <button
          onClick={toggleFocus}
          aria-pressed={focus}
          title="Focus mode: show three lines at a time and swap when the active line finishes the page"
          className={`btn btn-sm flex-none ${focus ? "btn-primary" : "btn-secondary"}`}
        >
          Focus
        </button>
      </div>
      <div
        className={`klr-card kf-lyrics relative overflow-hidden${fill ? " lg:min-h-0 lg:flex-1" : ""}${focus ? " focus-mode" : ""}`}
      >
        <div
          ref={linesRef}
          className={`kf-lines overflow-y-auto py-4 ${fill ? "max-h-96 lg:h-full lg:max-h-none" : "max-h-96"}`}
          style={{ opacity: 1 - 0.78 * countinOpacity }}
        >
        {payload.lines.map((line, i) => {
          const active = i === activeIndex;
          const past = timeMs >= line.end_ms && !active;
          // During a gap the upcoming line is staged center behind the
          // dimmed scroller, so the count-in lands right on it.
          const upcoming = activeGap !== null && i === activeGap.index;
          const pageCurrent = page >= 0 && pageOfLine[i] === page;
          const lineChords = showChords ? chordsByLine.get(i) : undefined;
          return (
            <p
              key={i}
              ref={(el) => {
                if ((active || upcoming) && el) activeRef.current = el;
              }}
              onClick={() => clock.seek(line.start_ms)}
              className={`line cursor-pointer ${active ? "active" : ""} ${past ? "past" : ""} ${pageCurrent ? "page-current" : ""}`}
            >
              {lineChords && (
                <span
                  className="mb-0.5 block text-[12px] font-bold tracking-tight"
                  style={{ fontFamily: "var(--font-mono)" }}
                  aria-hidden="true"
                >
                  {lineChords.map((seg, k) => (
                    <span
                      key={k}
                      className={
                        timeMs >= seg.start_ms && timeMs < seg.end_ms
                          ? "mr-3 text-[color:var(--klr-a)]"
                          : timeMs >= seg.end_ms
                            ? "mr-3 text-[color:var(--color-text-dim)] opacity-60"
                            : "mr-3 text-[color:var(--color-text-dim)]"
                      }
                    >
                      {seg.display}
                    </span>
                  ))}
                </span>
              )}
              {line.singer && (
                <span
                  className={`mr-2 inline-block rounded-full border px-2 py-px align-middle text-[10px] tracking-wide ${SINGER_STYLES[line.singer]}`}
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {line.singer}
                </span>
              )}
              {line.words && line.words.length > 0
                ? line.words.map((w, j) => {
                    const state = !active
                      ? ""
                      : timeMs >= w.end_ms
                        ? "sung"
                        : timeMs >= w.start_ms
                          ? "singing"
                          : "upcoming";
                    // The singing word wipes left→right; CSS reads
                    // --word-progress. With syllable timing the wipe
                    // follows the measured syllable boundaries.
                    const fill = state === "singing" ? wordFillPercent(w, timeMs) : undefined;
                    // The separator lives OUTSIDE the span (the .word spans
                    // are inline-block, which trims trailing whitespace) and
                    // comes from the line text itself: a space for Latin,
                    // nothing for Chinese/Thai (lib/word-separators.ts).
                    return (
                      <Fragment key={j}>
                        <span
                          className={`word ${state}`}
                          style={
                            fill !== undefined
                              ? ({ "--word-progress": `${fill}%` } as CSSProperties)
                              : undefined
                          }
                        >
                          {w.text}
                        </span>
                        {lineSeps[i]?.[j] ?? (j < line.words!.length - 1 ? " " : "")}
                      </Fragment>
                    );
                  })
                : line.text || <span className="opacity-50">♪</span>}
            </p>
          );
        })}
        </div>
        {/* Between-verse count-in (KaralyrWordLoader design): depleting bar
            + seconds remaining, fading over the dimmed lyrics. */}
        <div className="klr-countin" style={{ opacity: countinOpacity }} aria-hidden="true">
          <div className="klr-countin-track">
            <div className="klr-countin-fill" style={{ width: `${countinPct}%` }} />
          </div>
          <div className="klr-countin-num">{activeGap ? countinSeconds : ""}</div>
        </div>
      </div>
      <p className="text-xs text-[color:var(--color-text-dim)]">
        {captionLead} The current word lights up karaoke-style.
      </p>
    </div>
  );
}

export function LyricsPlayer({
  payload,
  durationSeconds,
  chordChart = null,
}: {
  payload: LyricsPayload;
  durationSeconds: number;
  chordChart?: ChordChart | null;
}) {
  const durationMs = durationSeconds * 1000;
  const clock = useSimulatorClock(durationMs);
  return (
    <LyricsView
      payload={payload}
      clock={clock}
      durationMs={durationMs}
      chordChart={chordChart}
      captionLead="Playback simulator - a plain clock, no audio. Click a line to jump."
    />
  );
}
