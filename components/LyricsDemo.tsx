"use client";

import { Fragment, useEffect, useRef, useState } from "react";

/**
 * Self-running karaoke demo for the hero: loops original placeholder lyrics
 * with the family word-sweep. No audio, just a clock.
 */

const LINE_MS = 2600;
const DEMO_LINES = [
  "You rewrote my logic line by line",
  "Deleted every bug I called mine",
  "Now my loops all terminate on time",
  "Refactor my heart one more time",
  "Every word arrives right on cue",
  "The whole room sings along with you",
].map((text) => text.split(" "));

const TOTAL_MS = DEMO_LINES.length * LINE_MS + 1200;

export function LyricsDemo() {
  const [now, setNow] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    const started = performance.now();
    const tick = () => {
      setNow((performance.now() - started) % TOTAL_MS);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const activeIndex = Math.min(Math.floor(now / LINE_MS), DEMO_LINES.length - 1);
  const lineProgress = Math.min((now - activeIndex * LINE_MS) / (LINE_MS - 350), 1);

  return (
    <div className="klr-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <span className="klr-eyebrow !text-[11px]">NOW SYNCING</span>
        <span
          className="text-[11px] text-[color:var(--color-text-dim)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Neon Practice — Refactor My Heart
        </span>
      </div>
      <div className="kf-lyrics select-none px-2 py-4" aria-hidden="true">
        {DEMO_LINES.map((words, i) => {
          const active = i === activeIndex;
          const sungCount = active ? lineProgress * words.length : 0;
          return (
            <p key={i} className={`line ${active ? "active" : ""} ${i < activeIndex ? "past" : ""}`}>
              {words.map((w, j) => {
                const state = !active
                  ? ""
                  : j + 1 <= sungCount
                    ? "sung"
                    : j <= sungCount
                      ? "singing"
                      : "upcoming";
                // Space outside the span: .word is inline-block, which
                // trims trailing whitespace inside it.
                return (
                  <Fragment key={j}>
                    <span className={`word ${state}`}>{w}</span>
                    {j < words.length - 1 ? " " : ""}
                  </Fragment>
                );
              })}
            </p>
          );
        })}
      </div>
    </div>
  );
}

/** Decorative tap-timing strip under the hero demo, from the design doc. */
export function TapStrip() {
  const bars = [
    [0, 11.5, 5], [5, 9.5, 9], [10, 7, 14], [15, 4, 20], [20, 8, 12], [25, 11, 6],
    [30, 9, 10], [35, 6, 16], [40, 3, 22], [45, 5.5, 17], [50, 9.5, 9], [55, 11.5, 5],
    [60, 8, 12], [65, 4.5, 19], [70, 2, 24], [75, 7, 14], [80, 10, 8], [85, 8.5, 11],
    [90, 5.5, 17], [95, 3.5, 21], [100, 7.5, 13], [105, 10.5, 7], [110, 6.5, 15], [115, 9.5, 9],
  ];
  return (
    <div className="klr-card mt-3 flex items-center gap-3.5 px-4 py-3">
      <span
        className="flex-none text-xs text-[color:var(--color-text-dim)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        00:42.31
      </span>
      <svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true" className="h-7 min-w-0 flex-1">
        {bars.map(([x, y, h], i) => (
          <rect
            key={i}
            x={x}
            y={y}
            width={3}
            height={h}
            rx={1}
            fill={i < 10 ? "var(--klr-b)" : "rgba(255,255,255,0.18)"}
          />
        ))}
      </svg>
      <span
        className="flex-none rounded-full px-3 py-1 text-[11px] tracking-[0.1em]"
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--klr-hi)",
          border: "1px solid color-mix(in srgb, var(--klr-b) 45%, transparent)",
          background: "color-mix(in srgb, var(--klr-b) 10%, transparent)",
        }}
      >
        TAP
      </span>
      <span
        className="flex-none text-xs text-[color:var(--color-text-dim)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        line 7 / 24
      </span>
    </div>
  );
}
