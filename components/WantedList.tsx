"use client";

import Link from "next/link";
import type { WantedSong } from "@/lib/db/queries";
import { parseVideoKey } from "@/lib/video-key";
import { QueueVoteButton } from "./QueueVoteButton";

/**
 * Ranked list of songs waiting for word-timed lyrics. Numbered because the
 * rank is the information — this is a demand leaderboard, not a catalogue.
 * `startRank` keeps the numbering honest across /queue pages.
 *
 * Each row's title opens the candidate page (/queue/[id]) with the full
 * story: player, complete lyrics, votes and comments.
 */
export function WantedList({
  songs,
  showVote = true,
  startRank = 1,
}: {
  songs: WantedSong[];
  showVote?: boolean;
  startRank?: number;
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
          <WantedRow song={song} rank={startRank + i} showVote={showVote} />
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
  // Always show the player when a song has one; loading="lazy" keeps
  // below-the-fold rows from fetching their iframes until scrolled to.
  const video = parseVideoKey(song.videoKey);

  return (
    <div className="klr-card flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5">
      <span
        className="w-6 shrink-0 text-right text-sm text-[color:var(--color-text-dim)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {rank}
      </span>

      <Link href={`/queue/${song.jobId}`} className="group min-w-0 flex-1">
        <p
          className="truncate font-medium transition-colors group-hover:text-[color:var(--klr-hi)]"
          title={song.trackName}
        >
          {song.trackName}
        </p>
        <p
          className="mt-0.5 truncate text-sm text-[color:var(--color-text-muted)]"
          title={song.artistName}
        >
          {song.artistName}
          {song.albumName && <> · {song.albumName}</>}
        </p>
      </Link>

      <div className="flex items-center gap-2.5">
        {song.trackId != null && (
          <Link
            href={`/track/${song.trackId}`}
            className="text-xs text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
          >
            In the library
          </Link>
        )}
        {!video && song.videoUrl ? (
          <a
            href={song.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
            title={song.videoUrl}
          >
            Listen ↗
          </a>
        ) : null}

        <span
          className="text-xs text-[color:var(--color-text-dim)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {song.voters} {song.voters === 1 ? "want" : "wants"}
        </span>

        {showVote && <QueueVoteButton jobId={song.jobId} nextPath="/queue" />}
      </div>

      {video && (
        <div className="flex w-full flex-wrap gap-5 pl-10">
          {video.platform === "youtube" ? (
            <div className="relative aspect-video w-full max-w-md flex-none overflow-hidden rounded-xl border border-white/10">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0`}
                title={`YouTube — ${song.artistName} – ${song.trackName}`}
                loading="lazy"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
                style={{ border: 0 }}
              />
            </div>
          ) : (
            <div className="w-full max-w-md flex-none self-start overflow-hidden rounded-xl border border-white/10">
              <iframe
                src={`https://open.spotify.com/embed/track/${video.id}`}
                title={`Spotify — ${song.artistName} – ${song.trackName}`}
                width="100%"
                height={152}
                loading="lazy"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                className="block"
                style={{ border: 0 }}
              />
            </div>
          )}
          {song.lyricsPreview && (
            <div className="min-w-0 flex-1 basis-56">
              <p className="klr-eyebrow mb-1.5 !text-[10px]">THE LYRICS SO FAR</p>
              <p
                className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--color-text-muted)]"
                style={{
                  WebkitMaskImage: "linear-gradient(180deg, #000 55%, transparent)",
                  maskImage: "linear-gradient(180deg, #000 55%, transparent)",
                }}
              >
                {song.lyricsPreview.split("\n").slice(0, 8).join("\n")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
