"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    <div className="flex items-center gap-3">
      <button
        onClick={() => setPlaying(!playing)}
        className="w-20 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <span className="w-12 text-right font-mono text-sm text-zinc-500">{fmt(timeMs)}</span>
      <input
        type="range"
        min={0}
        max={durationMs}
        value={timeMs}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-12 font-mono text-sm text-zinc-500">{fmt(durationMs)}</span>
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
      <div className="max-h-96 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        {payload.lines.map((line, i) => {
          const active = i === activeIndex;
          const past = timeMs >= line.end_ms && !active;
          return (
            <p
              key={i}
              ref={active ? activeRef : undefined}
              onClick={() => clock.seek(line.start_ms)}
              className={`cursor-pointer rounded px-2 py-1 transition-colors ${
                active
                  ? "bg-zinc-100 font-semibold dark:bg-zinc-900"
                  : past
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {line.singer && (
                <span className="mr-2 rounded bg-violet-100 px-1 text-xs text-violet-700 dark:bg-violet-900 dark:text-violet-300">
                  {line.singer}
                </span>
              )}
              {line.words && line.words.length > 0
                ? line.words.map((w, j) => (
                    <span
                      key={j}
                      className={
                        active && timeMs >= w.start_ms
                          ? timeMs < w.end_ms
                            ? "rounded bg-amber-200 text-zinc-900 dark:bg-amber-500"
                            : "text-amber-600 dark:text-amber-400"
                          : undefined
                      }
                    >
                      {w.text}
                      {j < line.words!.length - 1 ? " " : ""}
                    </span>
                  ))
                : line.text || <span className="text-zinc-400">♪</span>}
            </p>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">
        Playback simulator — a plain clock, no audio. Click a line to jump.
        {payload.meta.has_word_timing
          ? " The current word is highlighted karaoke-style."
          : " This revision has line-level timing only."}
      </p>
    </div>
  );
}
