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
import { gapSegments } from "@/lib/gaps";

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
}: {
  payload: LyricsPayload;
  clock: PlaybackClock;
  durationMs: number;
  captionLead: string;
  fill?: boolean;
}) {
  const { timeMs } = clock;
  const activeRef = useRef<HTMLElement | null>(null);

  // Focus mode (from the Karafilt side panel): show three lines at a time
  // and swap pages when the active line crosses a boundary. Persisted.
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    try {
      setFocus(localStorage.getItem("klr-focus") === "1");
    } catch {
      // storage unavailable — keep default
    }
  }, []);
  const toggleFocus = useCallback(() => {
    setFocus((f) => {
      try {
        localStorage.setItem("klr-focus", f ? "0" : "1");
      } catch {
        // storage unavailable — state still toggles for this session
      }
      return !f;
    });
  }, []);

  const gaps = useMemo(() => gapSegments(payload.lines), [payload]);
  const activeGap = gaps.find((g) => timeMs >= g.start && timeMs < g.end) ?? null;

  // Count-in: the bar FILLS toward the downbeat while the number counts the
  // seconds left. The overlay eases out between 2s and 1s remaining — fully
  // gone at 1s, when the upcoming text takes the stage (activeGap itself
  // runs to the true line start). Opacity is clock-driven per frame, so no
  // CSS transition (it would retarget every frame and stutter).
  const countinVisible = activeGap !== null && activeGap.end - timeMs > 1000;
  const countinOpacity = (() => {
    if (!activeGap) return 0;
    const entry = Math.min(1, (timeMs - activeGap.start) / 450);
    const linear = Math.min(1, Math.max(0, (activeGap.end - timeMs - 1000) / 1000));
    const exit = linear * linear * (3 - 2 * linear); // smoothstep — gentle ends
    return Math.min(entry, exit);
  })();

  // While the count-in is up, no line is active. In the gap's final second
  // the UPCOMING line takes the stage in "get ready" state — lit, every word
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
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, activeGap, focus]);

  return (
    <div className={fill ? "flex flex-col gap-4 lg:h-full" : "space-y-4"}>
      <div className="flex items-center gap-3.5">
        <div className="min-w-0 flex-1">
          <TransportBar {...clock} durationMs={durationMs} />
        </div>
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
          return (
            <p
              key={i}
              ref={(el) => {
                if ((active || upcoming) && el) activeRef.current = el;
              }}
              onClick={() => clock.seek(line.start_ms)}
              className={`line cursor-pointer ${active ? "active" : ""} ${past ? "past" : ""} ${pageCurrent ? "page-current" : ""}`}
            >
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
                    // The singing word wipes left→right across its own
                    // start→end window; CSS reads --word-progress.
                    const fill =
                      state === "singing"
                        ? w.end_ms > w.start_ms
                          ? Math.round(
                              (100 * (timeMs - w.start_ms)) / (w.end_ms - w.start_ms)
                            )
                          : 100
                        : undefined;
                    // The separating space lives OUTSIDE the span: the
                    // .word spans are inline-block, which trims trailing
                    // whitespace inside them.
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
                        {j < line.words!.length - 1 ? " " : ""}
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
        {captionLead}
        {payload.meta.has_word_timing
          ? " The current word lights up karaoke-style."
          : " This revision has line-level timing only."}
      </p>
    </div>
  );
}

export function LyricsPlayer({
  payload,
  durationSeconds,
}: {
  payload: LyricsPayload;
  durationSeconds: number;
}) {
  const durationMs = durationSeconds * 1000;
  const clock = useSimulatorClock(durationMs);
  return (
    <LyricsView
      payload={payload}
      clock={clock}
      durationMs={durationMs}
      captionLead="Playback simulator — a plain clock, no audio. Click a line to jump."
    />
  );
}
