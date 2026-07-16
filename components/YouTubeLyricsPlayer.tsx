"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricsPayload } from "@/lib/formats/types";
import { loadYouTubeIframeApi, type YTPlayer } from "@/lib/youtube-iframe";
import {
  LyricsView,
  useSimulatorClock,
  type PlaybackClock,
} from "./LyricsPlayer";

/** How long to wait for the IFrame API before falling back (adblockers). */
const READY_TIMEOUT_MS = 6000;
/** getCurrentTime() reports the pre-seek position until buffering settles. */
const SEEK_GRACE_MS = 300;

/**
 * A PlaybackClock driven by an embedded YouTube player. The widget only
 * reports getCurrentTime() a few times per second, so between reports the
 * clock extrapolates from a wall-clock anchor — word-level highlights move
 * smoothly instead of stepping.
 */
function useYouTubeClock(videoId: string, durationMs: number) {
  const [playing, setPlayingState] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const anchor = useRef<{ wall: number; media: number; rate: number } | null>(null);
  const seekGraceUntil = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || failed) return;
    let cancelled = false;
    let player: YTPlayer | null = null;
    let raf = 0;
    // YT.Player REPLACES its target element with the iframe, so never hand
    // it a React-rendered node: mount into a throwaway child instead.
    const holder = document.createElement("div");
    container.appendChild(holder);
    const readyTimeout = window.setTimeout(() => setFailed(true), READY_TIMEOUT_MS);

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) {
          holder.remove();
          return;
        }
        player = new YT.Player(holder, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 0, rel: 0, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              window.clearTimeout(readyTimeout);
              playerRef.current = player;
            },
            onStateChange: (e) => {
              // BUFFERING counts as playing so the button doesn't flicker
              // on seeks and initial spin-up.
              setPlayingState(
                e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING
              );
              anchor.current = null;
              const p = playerRef.current;
              if (p) setTimeMs(Math.min(Math.round(p.getCurrentTime() * 1000), durationMs));
            },
            onError: () => {
              // 2/5/100/101/150 — bad id, removed, or embedding disabled.
              window.clearTimeout(readyTimeout);
              setFailed(true);
            },
          },
        });

        const tick = () => {
          raf = requestAnimationFrame(tick);
          const p = playerRef.current;
          if (!p) return;
          if (performance.now() < seekGraceUntil.current) return;
          const polled = p.getCurrentTime() * 1000;
          if (!anchor.current || Math.abs(polled - anchor.current.media) > 1) {
            anchor.current = { wall: performance.now(), media: polled, rate: p.getPlaybackRate() };
          }
          const a = anchor.current;
          const isPlaying = p.getPlayerState() === YT.PlayerState.PLAYING;
          const next = Math.min(
            Math.round(isPlaying ? a.media + (performance.now() - a.wall) * a.rate : polled),
            durationMs
          );
          setTimeMs((prev) => {
            // Swallow sub-500ms backward corrections from re-anchoring while
            // playing; real backward seeks jump further and pass through.
            // While paused, follow raw polls so drags on YouTube's own
            // scrubber move the lyrics both directions.
            if (isPlaying && next < prev && prev - next < 500) return prev;
            return next;
          });
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(readyTimeout);
      playerRef.current = null;
      try {
        player?.destroy();
      } catch {
        // a half-constructed player can throw on destroy; nothing to clean
      }
      holder.remove();
    };
  }, [videoId, durationMs, failed]);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(ms, durationMs));
      setTimeMs(clamped); // optimistic: lyrics jump immediately
      anchor.current = null;
      seekGraceUntil.current = performance.now() + SEEK_GRACE_MS;
      playerRef.current?.seekTo(clamped / 1000, true);
    },
    [durationMs]
  );

  const setPlaying = useCallback((p: boolean) => {
    // Deliberately not optimistic: onStateChange is the source of truth, so
    // if the browser ignores programmatic play (iOS) the button stays honest.
    if (p) playerRef.current?.playVideo();
    else playerRef.current?.pauseVideo();
  }, []);

  return {
    clock: { playing, setPlaying, timeMs, seek } satisfies PlaybackClock,
    containerRef,
    failed,
  };
}

export function YouTubeLyricsPlayer({
  videoId,
  payload,
  durationSeconds,
}: {
  videoId: string;
  payload: LyricsPayload;
  durationSeconds: number;
}) {
  const durationMs = durationSeconds * 1000;
  const yt = useYouTubeClock(videoId, durationMs);
  // Both hooks always run (rules of hooks); the simulator idles until needed.
  const sim = useSimulatorClock(durationMs);
  const clock: PlaybackClock = yt.failed ? sim : yt.clock;

  if (yt.failed) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-[color:var(--color-text-dim)]">
          This video can&rsquo;t be embedded — lyrics run on the playback simulator instead.
        </p>
        <LyricsView
          payload={payload}
          clock={clock}
          durationMs={durationMs}
          captionLead="Playback simulator — a plain clock, no audio. Click a line to jump."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <div className="min-w-0">
        <div
          ref={yt.containerRef}
          className="klr-card relative aspect-video overflow-hidden [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full"
        />
      </div>
      {/* The absolute inner box makes the video's aspect height the row
          height — the lyrics column fills it instead of stretching it. */}
      <div className="min-w-0 lg:relative">
        <div className="lg:absolute lg:inset-0">
          <LyricsView
            payload={payload}
            clock={clock}
            durationMs={durationMs}
            fill
            captionLead="Synced to the video — click a line to jump."
          />
        </div>
      </div>
    </div>
  );
}
