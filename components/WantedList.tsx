"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WantedSong } from "@/lib/db/queries";

/**
 * Ranked list of songs waiting for word-timed lyrics. Numbered because the
 * rank is the information — this is a demand leaderboard, not a catalogue.
 *
 * Each row offers both trace directions: out to wherever the song can be heard
 * (the best link anyone supplied) and in to the track page when the song is
 * already in the library without word timing.
 */
export function WantedList({
  songs,
  showVote = true,
}: {
  songs: WantedSong[];
  showVote?: boolean;
}) {
  if (songs.length === 0) {
    return (
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Nothing waiting right now — every requested song has word-timed lyrics.
      </p>
    );
  }

  return (
    <ol className="flex list-none flex-col gap-2 p-0">
      {songs.map((song, i) => (
        <li key={song.jobId}>
          <WantedRow song={song} rank={i + 1} showVote={showVote} />
        </li>
      ))}
    </ol>
  );
}

function WantedRow({
  song,
  rank,
  showVote,
}: {
  song: WantedSong;
  rank: number;
  showVote: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function vote() {
    setState("sending");
    setError(null);
    const res = await fetch("/api/sync-queue/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: song.jobId }),
    });
    if (res.status === 401) {
      router.push(`/login?next=/queue`);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? "Could not record that");
      setState("idle");
      return;
    }
    setState("done");
    router.refresh();
  }

  return (
    <div className="klr-card flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5">
      <span
        className="w-6 shrink-0 text-right text-sm text-[color:var(--color-text-dim)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={song.trackName}>
          {song.trackName}
        </p>
        <p
          className="mt-0.5 truncate text-sm text-[color:var(--color-text-muted)]"
          title={song.artistName}
        >
          {song.artistName}
          {song.albumName && <> · {song.albumName}</>}
        </p>
      </div>

      <div className="flex items-center gap-2.5">
        {song.trackId != null && (
          <Link
            href={`/track/${song.trackId}`}
            className="text-xs text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
          >
            In the library
          </Link>
        )}
        {song.videoUrl && (
          <a
            href={song.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
            title={song.videoUrl}
          >
            {song.videoKey?.startsWith("sp:") ? "Spotify ↗" : "YouTube ↗"}
          </a>
        )}

        <span
          className="text-xs text-[color:var(--color-text-dim)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {song.voters} {song.voters === 1 ? "want" : "wants"}
        </span>

        {showVote && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={vote}
            disabled={state !== "idle"}
          >
            {state === "done" ? "Counted" : state === "sending" ? "…" : "I want this"}
          </button>
        )}
      </div>

      {error && (
        <p className="w-full text-xs" style={{ color: "var(--klr-hi)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
