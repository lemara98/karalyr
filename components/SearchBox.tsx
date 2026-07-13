"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TierBadge } from "./TierBadge";
import type { Tier } from "@/lib/db/schema";

interface Result {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  karalyr: { tier: Tier | null; has_lyrics: boolean };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim() === "") {
      setResults(null);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        setResults(res.ok ? await res.json() : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by artist or title…"
        className="field !rounded-full !px-5 !py-3.5 !text-base"
      />
      {loading && (
        <p className="mt-4 text-sm text-[color:var(--color-text-dim)]">Searching…</p>
      )}
      {results !== null && !loading && (
        <ul className="mt-4 divide-y divide-white/5">
          {results.length === 0 && (
            <li className="py-4 text-sm text-[color:var(--color-text-muted)]">
              No matches. Karaoke clients trigger automatic imports from LRCLIB
              on lookup, or you can{" "}
              <Link href="/contribute" className="text-[color:var(--klr-b)] hover:text-[color:var(--klr-hi)]">
                sync it yourself
              </Link>
              .
            </li>
          )}
          {results.map((r) => (
            <li key={r.id}>
              <Link
                href={`/track/${r.id}`}
                className="-mx-3 flex items-center justify-between gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.04]"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{r.artistName}</span>
                  <span className="text-[color:var(--color-text-dim)]"> — </span>
                  {r.trackName}
                  {r.albumName && (
                    <span className="ml-2 text-xs text-[color:var(--color-text-dim)]">
                      {r.albumName}
                    </span>
                  )}
                </span>
                <span className="flex flex-none items-center gap-2.5 text-sm text-[color:var(--color-text-dim)]">
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {formatDuration(r.duration)}
                  </span>
                  <TierBadge tier={r.karalyr.tier} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
