import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { listTrackVideos } from "@/lib/db/queries";
import { revisions, tracks } from "@/lib/db/schema";
import { validatePayload } from "@/lib/formats";
import { parseVideoKey, pickPreferredVideoKey } from "@/lib/video-key";
import { AnnotatedLyrics } from "@/components/AnnotatedLyrics";
import { ExportButtons } from "@/components/ExportButtons";
import { LyricsPlayer } from "@/components/LyricsPlayer";
import { RevisionList } from "@/components/RevisionList";
import { SignalButtons } from "@/components/SignalButtons";
import { SpotifyEmbed } from "@/components/SpotifyEmbed";
import { TierBadge } from "@/components/TierBadge";
import { WordSyncBadge } from "@/components/WordSyncBadge";
import { YouTubeEmbed } from "@/components/YouTubeEmbed";
import { YouTubeLyricsPlayer } from "@/components/YouTubeLyricsPlayer";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function TrackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (!Number.isFinite(trackId)) notFound();

  const db = getDb();
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) notFound();

  const best =
    track.bestRevisionId != null
      ? (await db.select().from(revisions).where(eq(revisions.id, track.bestRevisionId)))[0]
      : undefined;

  const payload = best ? validatePayload(JSON.parse(best.payload)) : null;

  const video = parseVideoKey(pickPreferredVideoKey(await listTrackVideos(db, trackId)));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="text-3xl font-bold tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {track.trackName}
          </h1>
          <TierBadge tier={best?.tier ?? null} />
          {payload?.meta.has_word_timing && <WordSyncBadge />}
        </div>
        <p className="mt-1.5 text-[color:var(--color-text-muted)]">
          {track.artistName}
          {track.albumName && <> · {track.albumName}</>} ·{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {formatDuration(track.durationSeconds)}
          </span>
          {best && (
            <span className="ml-2 text-xs text-[color:var(--color-text-dim)]">
              revision #{best.id} ({best.source})
            </span>
          )}
        </p>
      </div>

      {payload && best ? (
        <>
          {video?.platform === "spotify" && <SpotifyEmbed spotifyTrackId={video.id} />}
          {video?.platform === "youtube" ? (
            <YouTubeLyricsPlayer
              videoId={video.id}
              payload={payload}
              durationSeconds={track.durationSeconds}
            />
          ) : (
            <LyricsPlayer payload={payload} durationSeconds={track.durationSeconds} />
          )}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SignalButtons revisionId={best.id} />
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/contribute?track=${track.id}`} className="btn btn-secondary btn-sm">
                Fix these lyrics
              </Link>
              <ExportButtons
                payload={payload}
                baseName={`${track.artistName} - ${track.trackName}`}
              />
            </div>
          </div>
          <AnnotatedLyrics trackId={track.id} revisionId={best.id} payload={payload} />
        </>
      ) : (
        <>
          {video?.platform === "youtube" && <YouTubeEmbed videoId={video.id} />}
          {video?.platform === "spotify" && <SpotifyEmbed spotifyTrackId={video.id} />}
          <p className="text-[color:var(--color-text-muted)]">No lyrics yet for this track.</p>
        </>
      )}

      <RevisionList trackId={track.id} />
    </div>
  );
}
