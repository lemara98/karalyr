"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryPageTrack } from "@/lib/db/queries";
import { trackPath } from "@/lib/track-slug";
import { TierBadge } from "./TierBadge";
import { WordSyncBadge } from "./WordSyncBadge";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function BrowserCard({ track }: { track: LibraryPageTrack }) {
  return (
    <Link
      href={trackPath(track)}
      className="klr-card group flex flex-col gap-2.5 p-4 transition-colors hover:border-white/15"
    >
      <div className="min-w-0">
        <p
          className="truncate text-sm font-medium transition-colors group-hover:text-[color:var(--klr-hi)]"
          title={track.trackName}
        >
          {track.trackName}
        </p>
        <p
          className="mt-0.5 truncate text-[13px] text-[color:var(--color-text-muted)]"
          title={track.artistName}
        >
          {track.artistName}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <TierBadge tier={track.bestTier} />
        {track.bestHasWordTiming && <WordSyncBadge />}
        <span
          className="ml-auto text-[11px] text-[color:var(--color-text-dim)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {formatDuration(track.durationSeconds)}
        </span>
      </div>
    </Link>
  );
}

/**
 * The whole library, newest first, loaded a page at a time as the reader
 * scrolls. The first page is rendered on the server so the section is never
 * empty (and stays crawlable); every following page comes from /api/library
 * keyed on the last track id we hold.
 *
 * A sentinel below the grid triggers the fetch ~400px early; the same call
 * sits behind a real button so the section works without an observer, when a
 * request fails, and for keyboard users.
 */
export function LibraryBrowser({
  initialItems,
  initialCursor,
  total,
  lang,
}: {
  initialItems: LibraryPageTrack[];
  initialCursor: number | null;
  total: number;
  /** ISO 639-1 filter the server page was rendered with; threaded to /api/library. */
  lang?: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  // Read inside loadMore without making the callback (and the observer that
  // depends on it) churn on every state change.
  const state = useRef({ cursor: initialCursor, loading: false, error: false });
  state.current = { cursor, loading, error };

  const loadMore = useCallback(async () => {
    const { cursor: at, loading: busy } = state.current;
    if (at === null || busy) return;
    state.current.loading = true;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/library?cursor=${at}${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page: { items: LibraryPageTrack[]; nextCursor: number | null } = await res.json();
      // Guard against a double-fire appending the same page twice.
      setItems((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...page.items.filter((t) => !seen.has(t.id))];
      });
      setCursor(page.nextCursor);
      state.current.cursor = page.nextCursor;
    } catch {
      setError(true);
    } finally {
      state.current.loading = false;
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Never auto-retry after a failure - the button does that, so a
        // broken connection cannot spin on the sentinel.
        if (entries[0].isIntersecting && !state.current.error) void loadMore();
      },
      { rootMargin: "400px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
    // Re-observing after each page re-delivers the sentinel's current state:
    // on a tall viewport (or a short page) it is still in view and the next
    // page loads straight away instead of waiting for a scroll that the
    // reader has no reason to make.
  }, [loadMore, items.length]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((t) => (
          <BrowserCard key={t.id} track={t} />
        ))}
      </div>

      <div ref={sentinel} className="mt-6 flex flex-col items-center gap-3">
        {loading && (
          <p className="text-sm text-[color:var(--color-text-dim)]">Loading more songs…</p>
        )}
        {error && !loading && (
          <p className="text-sm text-[color:var(--color-text-muted)]">
            That page didn&apos;t load. Try again?
          </p>
        )}
        {cursor !== null && !loading && (
          <button type="button" onClick={() => void loadMore()} className="btn btn-secondary btn-sm">
            {error ? "Retry" : "Load more"}
          </button>
        )}
        {cursor === null && items.length > 0 && (
          <p
            className="text-[11px] text-[color:var(--color-text-dim)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {items.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")} - that&apos;s
            every song.
          </p>
        )}
      </div>
    </div>
  );
}
