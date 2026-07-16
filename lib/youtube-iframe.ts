// Minimal loader + types for the YouTube IFrame Player API. Hand-rolled on
// purpose: we call six player methods, and @types/youtube would install an
// ambient global YT namespace across the whole repo for that.
//
// Client-only — call loadYouTubeIframeApi() from an effect, never on the
// server. The API script itself always comes from www.youtube.com; the
// player iframe host (youtube-nocookie.com) is set per-player via `host`.

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  destroy(): void;
}

export interface YTPlayerOptions {
  videoId: string;
  host?: string;
  width?: string | number;
  height?: string | number;
  playerVars?: {
    autoplay?: 0 | 1;
    rel?: 0 | 1;
    playsinline?: 0 | 1;
    origin?: string;
  };
  events?: {
    onReady?: (e: { target: YTPlayer }) => void;
    onStateChange?: (e: { data: number }) => void;
    onError?: (e: { data: number }) => void;
  };
}

export interface YTNamespace {
  /** Replaces the given element with the player iframe. */
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/**
 * Load the IFrame API once per page; safe to call from multiple mounts
 * (StrictMode included) — every caller shares the same promise.
 */
export function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT!);
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.async = true;
        document.head.appendChild(s);
      }
    });
  }
  return apiPromise;
}
