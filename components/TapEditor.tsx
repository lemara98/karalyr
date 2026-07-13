"use client";

import { useEffect, useState } from "react";
import { TransportBar, useSimulatorClock } from "./LyricsPlayer";
import type { LyricsPayload } from "@/lib/formats/types";
import { TRAILING_DURATION_MS } from "@/lib/formats/types";

/**
 * Minimal tap-timing editor: paste plain lyrics (one line per row), play the
 * simulator clock, tap Space to stamp each line's start. Line ends are the
 * next line's start.
 */
export function TapEditor({
  durationSeconds,
  onPayloadReady,
}: {
  durationSeconds: number;
  onPayloadReady: (payload: LyricsPayload | null) => void;
}) {
  const [text, setText] = useState("");
  const [stamps, setStamps] = useState<(number | null)[]>([]);
  const [cursor, setCursor] = useState(0);
  const durationMs = Math.max(1, Math.round(durationSeconds * 1000));
  const clock = useSimulatorClock(durationMs);

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");

  function beginTapping() {
    setStamps(new Array(lines.length).fill(null));
    setCursor(0);
    clock.seek(0);
    clock.setPlaying(true);
    onPayloadReady(null);
  }

  useEffect(() => {
    if (!clock.playing || stamps.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      setCursor((c) => {
        if (c >= stamps.length) return c;
        setStamps((prev) => {
          const next = [...prev];
          next[c] = Math.round(clock.timeMs);
          return next;
        });
        return c + 1;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock.playing, clock.timeMs, stamps.length]);

  // When every line has a stamp, build the payload.
  useEffect(() => {
    if (stamps.length === 0 || stamps.some((s) => s === null)) return;
    const stamped = stamps as number[];
    const payload: LyricsPayload = {
      format_version: 1,
      lines: lines.map((line, i) => ({
        start_ms: stamped[i],
        end_ms:
          i + 1 < stamped.length
            ? stamped[i + 1]
            : Math.min(stamped[i] + TRAILING_DURATION_MS, durationMs),
        singer: null,
        text: line,
      })),
      meta: { language: null, has_word_timing: false, countdown_lines: [] },
    };
    onPayloadReady(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamps]);

  const tapping = stamps.length > 0;

  return (
    <div className="space-y-4">
      {!tapping && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"Paste plain lyrics, one line per row…"}
            className="field !rounded-xl text-sm"
            style={{ fontFamily: "var(--font-mono)" }}
          />
          <button
            onClick={beginTapping}
            disabled={lines.length === 0 || durationSeconds <= 0}
            className="btn btn-primary"
          >
            Start tap timing ({lines.length} lines)
          </button>
          {durationSeconds <= 0 && (
            <p className="text-xs text-[color:var(--klr-hi)]">
              Set the track duration above first.
            </p>
          )}
        </>
      )}
      {tapping && (
        <>
          <TransportBar {...clock} durationMs={durationMs} />
          <p className="text-sm text-[color:var(--color-text-muted)]">
            Press{" "}
            <kbd className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs">
              Space
            </kbd>{" "}
            when each line starts. {cursor}/{lines.length} stamped.
          </p>
          <ol className="klr-card max-h-72 space-y-0.5 overflow-y-auto p-4 text-sm">
            {lines.map((line, i) => (
              <li
                key={i}
                className={
                  i === cursor
                    ? "font-semibold text-[color:var(--klr-hi)]"
                    : i < cursor
                      ? "text-[color:var(--color-text-dim)]"
                      : "text-[color:var(--color-text-muted)]"
                }
              >
                <span
                  className="mr-2 inline-block w-16 text-xs text-[color:var(--color-text-dim)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {stamps[i] !== null ? `${(stamps[i]! / 1000).toFixed(2)}s` : "--"}
                </span>
                {line}
              </li>
            ))}
          </ol>
          <button
            onClick={() => {
              clock.setPlaying(false);
              setStamps([]);
              setCursor(0);
              onPayloadReady(null);
            }}
            className="btn btn-secondary btn-sm"
          >
            Reset
          </button>
        </>
      )}
    </div>
  );
}
