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
        autoFocus
        className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-lg outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
      {loading && <p className="mt-4 text-sm text-zinc-500">Searching…</p>}
      {results !== null && !loading && (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {results.length === 0 && (
            <li className="py-4 text-sm text-zinc-500">
              No matches. Karaoke clients trigger automatic imports from
              LRCLIB on lookup, or you can{" "}
              <Link href="/contribute" className="underline">
                contribute lyrics
              </Link>
              .
            </li>
          )}
          {results.map((r) => (
            <li key={r.id}>
              <Link
                href={`/track/${r.id}`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 px-2 -mx-2 rounded"
              >
                <span>
                  <span className="font-medium">{r.artistName}</span>
                  <span className="text-zinc-500"> — </span>
                  {r.trackName}
                  {r.albumName && (
                    <span className="ml-2 text-xs text-zinc-500">{r.albumName}</span>
                  )}
                </span>
                <span className="flex items-center gap-2 text-sm text-zinc-500">
                  {formatDuration(r.duration)}
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
