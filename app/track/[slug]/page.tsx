import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getActiveChordChart, listTrackVideos } from "@/lib/db/queries";
import { revisions, tracks } from "@/lib/db/schema";
import { validateChordChart, validatePayload, type ChordChart } from "@/lib/formats";
import { parseTrackSlug, trackSlug } from "@/lib/track-slug";
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

/** Params arrive percent-encoded; native-script slugs need decoding before
 *  any comparison. Malformed sequences fall back to the raw string. */
function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Track pages are the site's search-traffic surface, and for non-English
 * songs the native-script title IS the query people type. Deliberately no
 * lyric text in the description - quoting lyrics in metadata is a rights
 * redistribution surface the pages themselves avoid.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const slug = decodeSlug((await params).slug);
  const trackId = parseTrackSlug(slug);
  if (trackId == null) return {};
  const [track] = await getDb().select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) return {};

  const title = `${track.trackName} – ${track.artistName} | word-synced karaoke lyrics`;
  const description =
    `Sing ${track.trackName} by ${track.artistName} with word-level timed karaoke lyrics ` +
    `on Karalyr - free, community-corrected, and exportable as Enhanced LRC.`;
  return {
    title,
    description,
    alternates: { canonical: `/track/${trackSlug(track)}` },
    openGraph: {
      title,
      description,
      type: "music.song",
      ...(track.language ? { locale: track.language } : {}),
    },
  };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function TrackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = decodeSlug((await params).slug);
  const trackId = parseTrackSlug(slug);
  if (trackId == null) notFound();

  const db = getDb();
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) notFound();

  // Bare-id links and stale slugs (a renamed track, a hand-typed URL) resolve,
  // then send the reader - and any crawler - to the one canonical address.
  // The Location header must be ASCII, so the native-script slug is percent-
  // encoded on the wire (params arrive decoded, so the comparison is exact).
  const canonical = trackSlug(track);
  if (slug !== canonical) permanentRedirect(`/track/${encodeURIComponent(canonical)}`);

  const best =
    track.bestRevisionId != null
      ? (await db.select().from(revisions).where(eq(revisions.id, track.bestRevisionId)))[0]
      : undefined;

  const payload = best ? validatePayload(JSON.parse(best.payload)) : null;

  // The chord lane is best-effort: a chart that fails validation (schema
  // drift, manual tampering) just doesn't render, it never 500s the page.
  let chordChart: ChordChart | null = null;
  const chartRow = await getActiveChordChart(db, trackId);
  if (chartRow) {
    try {
      chordChart = validateChordChart(JSON.parse(chartRow.payload));
      if (chordChart.segments.length === 0) chordChart = null;
    } catch {
      chordChart = null;
    }
  }

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
          {/* lang on the lyric blocks (not the page): correct shaping and
              screen-reader pronunciation for the song text; layout-neutral
              via display:contents. */}
          <div lang={track.language ?? undefined} className="contents">
            {video?.platform === "youtube" ? (
              <YouTubeLyricsPlayer
                videoId={video.id}
                payload={payload}
                durationSeconds={track.durationSeconds}
                chordChart={chordChart}
              />
            ) : (
              <LyricsPlayer
                payload={payload}
                durationSeconds={track.durationSeconds}
                chordChart={chordChart}
              />
            )}
          </div>
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
          <div lang={track.language ?? undefined} className="contents">
            <AnnotatedLyrics trackId={track.id} revisionId={best.id} payload={payload} />
          </div>
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
