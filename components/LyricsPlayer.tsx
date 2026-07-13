"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { LyricsPayload } from "@/lib/formats/types";

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
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
}: ReturnType<typeof useSimulatorClock> & { durationMs: number }) {
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

const SINGER_STYLES: Record<string, string> = {
  P1: "border-[color:color-mix(in_srgb,var(--klr-a)_45%,transparent)] text-[color:var(--klr-a)]",
  P2: "border-[color:color-mix(in_srgb,var(--klr-b)_45%,transparent)] text-[color:var(--klr-b)]",
  BOTH: "border-white/25 text-[color:var(--color-text-muted)]",
};

export function LyricsPlayer({
  payload,
  durationSeconds,
}: {
  payload: LyricsPayload;
  durationSeconds: number;
}) {
  const durationMs = durationSeconds * 1000;
  const clock = useSimulatorClock(durationMs);
  const { timeMs } = clock;
  const activeRef = useRef<HTMLParagraphElement | null>(null);

  const activeIndex = payload.lines.findIndex(
    (l, i) =>
      timeMs >= l.start_ms &&
      (timeMs < l.end_ms || (payload.lines[i + 1] && timeMs < payload.lines[i + 1].start_ms))
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div className="space-y-4">
      <TransportBar {...clock} durationMs={durationMs} />
      <div className="klr-card kf-lyrics max-h-96 overflow-y-auto py-4">
        {payload.lines.map((line, i) => {
          const active = i === activeIndex;
          const past = timeMs >= line.end_ms && !active;
          return (
            <p
              key={i}
              ref={active ? activeRef : undefined}
              onClick={() => clock.seek(line.start_ms)}
              className={`line cursor-pointer ${active ? "active" : ""} ${past ? "past" : ""}`}
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
                    // The separating space lives OUTSIDE the span: the
                    // .word spans are inline-block, which trims trailing
                    // whitespace inside them.
                    return (
                      <Fragment key={j}>
                        <span className={`word ${state}`}>{w.text}</span>
                        {j < line.words!.length - 1 ? " " : ""}
                      </Fragment>
                    );
                  })
                : line.text || <span className="opacity-50">♪</span>}
            </p>
          );
        })}
      </div>
      <p className="text-xs text-[color:var(--color-text-dim)]">
        Playback simulator — a plain clock, no audio. Click a line to jump.
        {payload.meta.has_word_timing
          ? " The current word lights up karaoke-style."
          : " This revision has line-level timing only."}
      </p>
    </div>
  );
}
