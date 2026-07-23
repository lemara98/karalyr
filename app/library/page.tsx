import type { Metadata } from "next";
import Link from "next/link";
import { count, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  listLibraryTracks,
  listNewestSyncedTracks,
  type LibraryTrack,
  type NewestSyncedTrack,
} from "@/lib/db/queries";
import { revisions, tracks, trackVideos } from "@/lib/db/schema";
import { parseVideoKey } from "@/lib/video-key";
import { SearchBox } from "@/components/SearchBox";
import { StatCard } from "@/components/StatCard";
import { TierBadge } from "@/components/TierBadge";
import { WordSyncBadge } from "@/components/WordSyncBadge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library — Karalyr",
  description: "Every song with karaoke lyrics on Karalyr — the newest arrivals and the crowd's top rated.",
};

/** First linked YouTube video / Spotify track per platform, if any. */
type TrackLinks = { youtube?: string; spotify?: string };

function ScoreTag({ score }: { score: number }) {
  if (score === 0) return null;
  const positive = score > 0;
  return (
    <span
      className={`text-[11px] ${positive ? "text-[color:var(--klr-hi)]" : "text-[color:var(--color-text-dim)]"}`}
      style={{ fontFamily: "var(--font-mono)" }}
      title="Net votes on the current lyrics"
    >
      {positive ? `▲ +${score}` : `▼ ${score}`}
    </span>
  );
}

/**
 * A grid card: the embed sits outside the link (an iframe cannot live inside
 * an anchor), so the title block links to the track page and the player
 * stays independently clickable.
 */
function TrackCard({ track, links }: { track: LibraryTrack; links?: TrackLinks }) {
  return (
    <div className="klr-card group flex flex-col gap-3 p-4 transition-colors hover:border-white/15">
      <Link href={`/track/${track.id}`} className="min-w-0">
        <p
          className="truncate font-medium transition-colors group-hover:text-[color:var(--klr-hi)]"
          title={track.trackName}
        >
          {track.trackName}
        </p>
        <p className="mt-0.5 truncate text-sm text-[color:var(--color-text-muted)]" title={track.artistName}>
          {track.artistName}
        </p>
      </Link>
      {links?.youtube ? (
        <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${links.youtube}?rel=0`}
            title={`YouTube — ${track.artistName} – ${track.trackName}`}
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
            style={{ border: 0 }}
          />
        </div>
      ) : links?.spotify ? (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <iframe
            src={`https://open.spotify.com/embed/track/${links.spotify}`}
            title={`Spotify — ${track.artistName} – ${track.trackName}`}
            width="100%"
            height={152}
            loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            className="block"
            style={{ border: 0 }}
          />
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <TierBadge tier={track.bestTier} />
        {track.bestHasWordTiming && <WordSyncBadge />}
        <span className="ml-auto inline-flex items-center gap-2">
          <ScoreTag score={track.score} />
          <span
            className="text-[11px] text-[color:var(--color-text-dim)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {track.singers > 0
              ? `${track.singers} ${track.singers === 1 ? "singer" : "singers"}`
              : "new"}
          </span>
        </span>
      </div>
    </div>
  );
}

/** One compact card inside the marquee; hidden duplicates stay untabbable. */
function CarouselCard({ track, hidden }: { track: NewestSyncedTrack; hidden?: boolean }) {
  return (
    <Link
      href={`/track/${track.id}`}
      tabIndex={hidden ? -1 : undefined}
      className="klr-card flex w-56 flex-none flex-col gap-2.5 p-4 transition-colors hover:border-white/15"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{track.trackName}</p>
        <p className="mt-0.5 truncate text-[13px] text-[color:var(--color-text-muted)]">
          {track.artistName}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <TierBadge tier={track.bestTier} />
        {track.bestHasWordTiming && <WordSyncBadge />}
      </div>
    </Link>
  );
}

export default async function LibraryPage() {
  const db = getDb();
  const [[trackStats], [readyStats], [revisionStats], [wordSynced], newest, ranked] =
    await Promise.all([
      db.select({ n: count() }).from(tracks),
      db.select({ n: count() }).from(tracks).where(isNotNull(tracks.bestRevisionId)),
      db.select({ n: count() }).from(revisions),
      db.all<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM tracks t
        JOIN revisions r ON r.id = t.best_revision_id
        WHERE json_extract(r.payload, '$.meta.has_word_timing') = 1
      `),
      listNewestSyncedTracks(db, 12),
      listLibraryTracks(db, 60),
    ]);

  // The grid: only tracks with real usage or a positive vote balance.
  const top = ranked.filter((t) => t.singers > 0 || t.score > 0);

  // Linked videos for the grid cards — first YouTube and Spotify key each.
  const links = new Map<number, TrackLinks>();
  if (top.length > 0) {
    const rows = await db
      .select()
      .from(trackVideos)
      .where(inArray(trackVideos.trackId, top.map((t) => t.id)));
    for (const row of rows) {
      const parsed = parseVideoKey(row.videoKey);
      if (!parsed) continue;
      const entry = links.get(row.trackId) ?? {};
      if (parsed.platform === "youtube") entry.youtube ??= parsed.id;
      else entry.spotify ??= parsed.id;
      links.set(row.trackId, entry);
    }
  }

  // Marquee cards: the freshest karaoke lyrics. The set repeats until one
  // half of the strip is wider than the widest container (max-w-6xl,
  // ~236px per card), so the -50% loop never gaps.
  const carousel: NewestSyncedTrack[] = [];
  if (newest.length >= 2) {
    while (carousel.length * 236 < 1400) carousel.push(...newest);
  }

  return (
    <div>
      {/* Header + search */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(560px 300px at 82% 0%, color-mix(in srgb, var(--klr-b) 9%, transparent), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 pb-4 pt-14">
          <p className="klr-eyebrow">THE LIBRARY</p>
          <h1
            className="mb-3 mt-2.5 text-[40px] font-bold tracking-[-0.025em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Every song, ready to sing
          </h1>
          <p className="mb-7 max-w-xl text-[15px] text-[color:var(--color-text-muted)]">
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {readyStats.n.toLocaleString("en-US")}
            </span>{" "}
            {readyStats.n === 1 ? "song" : "songs"} with karaoke lyrics — the newest arrivals
            on rotation, the crowd&apos;s favorites below.
          </p>
          <SearchBox />
        </div>
      </section>

      {/* Stats */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="TRACKS IN THE LIBRARY"
              value={trackStats.n.toLocaleString("en-US")}
              hint="Every duration is its own track"
            />
            <StatCard
              label="READY TO SING"
              value={readyStats.n.toLocaleString("en-US")}
              hint="Tracks with published karaoke lyrics"
            />
            <StatCard
              label="WORD-SYNCED"
              value={(wordSynced?.n ?? 0).toLocaleString("en-US")}
              hint="Lyrics timed word by word"
            />
            <StatCard
              label="LYRIC REVISIONS"
              value={revisionStats.n.toLocaleString("en-US")}
              hint="Immutable — nothing is ever overwritten"
            />
          </div>
        </div>
      </section>

      {/* Carousel: the newest published karaoke lyrics */}
      {carousel.length > 0 && (
        <section className="border-t border-white/5">
          <div className="mx-auto max-w-6xl px-6 py-12">
            <p className="klr-eyebrow !text-[11px]">JUST SYNCED</p>
            <p className="mb-5 mt-1.5 text-sm text-[color:var(--color-text-muted)]">
              The latest karaoke lyrics to land in the library.
            </p>
            <div className="klr-marquee">
              <div
                className="klr-marquee-row"
                style={{ "--marquee-s": `${carousel.length * 5}s` } as React.CSSProperties}
              >
                <div className="klr-marquee-half">
                  {carousel.map((t, i) => (
                    <CarouselCard key={`${t.id}-${i}`} track={t} />
                  ))}
                </div>
                <div className="klr-marquee-half" aria-hidden="true">
                  {carousel.map((t, i) => (
                    <CarouselCard key={`${t.id}-${i}`} track={t} hidden />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Top rated / most listened, with linked players */}
      <section className="border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <p className="klr-eyebrow !text-[11px]">TOP RATED &amp; MOST SUNG</p>
          <p className="mb-4 mt-1.5 text-sm text-[color:var(--color-text-muted)]">
            The library&apos;s proven songs — ranked by votes and singers, with the linked
            YouTube or Spotify player where one exists.
          </p>
          {top.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {top.map((t) => (
                <TrackCard key={t.id} track={t} links={links.get(t.id)} />
              ))}
            </div>
          ) : (
            <div className="klr-card p-8 text-center text-sm text-[color:var(--color-text-dim)]">
              No songs have usage or votes yet. Sing one with Karafilt, or upvote lyrics
              that worked — favorites show up here.
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10">
          <p className="text-sm text-[color:var(--color-text-muted)]">
            Missing a song? Sync it yourself in a few minutes.
          </p>
          <div className="flex items-center gap-3">
            <Link href="/contribute" className="btn btn-primary btn-sm">
              Open the Studio
            </Link>
            <Link href="/queue" className="btn btn-secondary btn-sm">
              The wanted queue
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
