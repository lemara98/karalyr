import Link from "next/link";
import { countDistinct, count, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { listMostUsedTracks, listMostWantedSongs } from "@/lib/db/queries";
import { revisions, tracks } from "@/lib/db/schema";
import { getContributors } from "@/lib/github";
import { ContributorsGrid } from "@/components/ContributorsGrid";
import { KaralyrMark } from "@/components/KaralyrMark";
import { LyricsDemo } from "@/components/LyricsDemo";
import { SearchBox } from "@/components/SearchBox";
import { StatCard } from "@/components/StatCard";
import { TierBadge } from "@/components/TierBadge";
import { WantedList } from "@/components/WantedList";
import { WordSyncBadge } from "@/components/WordSyncBadge";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Tap to sync",
    body: "Play the track and tap each line as it lands. Timings snap clean, down to the syllable.",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="var(--klr-b)" strokeWidth="1.8" />
        <circle cx="10" cy="10" r="2.4" fill="var(--klr-b)" />
      </svg>
    ),
  },
  {
    title: "Word-level fill",
    body: "Word timing drives the classic karaoke sweep — the same engine Karafilt plays back.",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
        <rect x="3" y="4.4" width="14" height="2.8" rx="1.4" fill="var(--klr-b)" />
        <rect x="3" y="9.6" width="6" height="2.8" rx="1.4" fill="var(--klr-b)" />
        <rect x="10.4" y="9.6" width="6.6" height="2.8" rx="1.4" fill="rgba(255,255,255,0.25)" />
        <rect x="3" y="14.8" width="10" height="2.8" rx="1.4" fill="rgba(255,255,255,0.25)" />
      </svg>
    ),
  },
  {
    title: "Publish to the library",
    body: "Every submission becomes a public revision, served by a free LRCLIB-compatible API.",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
        <path
          d="M5.5 14.5 14.5 5.5M8 5.5h6.5V12"
          fill="none"
          stroke="var(--klr-b)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const STEPS = [
  {
    n: "01",
    title: "Paste your lyrics",
    body: "Drop in plain text, or import an existing .lrc, Enhanced LRC, or UltraStar file.",
  },
  {
    n: "02",
    title: "Play and tap",
    body: "Follow the simulator clock and tap on each line. Nudge anything after, millisecond by millisecond.",
  },
  {
    n: "03",
    title: "Export or publish",
    body: "Download the .lrc, or publish it to the library for every karaoke player to use.",
  },
];

export default async function HomePage() {
  const db = getDb();
  const [[trackStats], [revisionStats], [lyricsStats], mostUsed, mostWanted, contributors] = await Promise.all([
    db.select({ n: count() }).from(tracks),
    db
      .select({
        n: count(),
        contributors: countDistinct(revisions.submitterFingerprint),
      })
      .from(revisions)
      .where(sql`${revisions.submitterFingerprint} NOT LIKE 'system:%'`),
    db.select({ n: count() }).from(tracks).where(isNotNull(tracks.bestRevisionId)),
    listMostUsedTracks(db),
    listMostWantedSongs(db, 10),
    getContributors(),
  ]);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(560px 320px at 78% 10%, color-mix(in srgb, var(--klr-b) 10%, transparent), transparent 70%), radial-gradient(480px 300px at 8% 90%, rgba(139,124,255,0.08), transparent 70%)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 py-16 lg:grid-cols-[1.04fr_0.96fr] lg:py-19">
          <div>
            <p className="mb-4.5 inline-flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-1.5 text-[11px] tracking-[0.12em] text-[color:var(--color-text-muted)]" style={{ fontFamily: "var(--font-mono)" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--klr-b)]" />
              FROM THE KARAFILT FAMILY
            </p>
            <h1
              className="text-5xl font-bold leading-[1.04] tracking-[-0.025em] sm:text-[56px]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Every word,
              <br />
              <span className="brand-gradient">right on time</span>.
            </h1>
            <p className="mt-5.5 max-w-md text-[17px] leading-relaxed text-[color:var(--color-text-muted)]">
              Karalyr is the open karaoke lyrics database. Time lyrics to any
              track — line by line, word by word — and publish them straight to
              the library Karafilt plays.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/contribute" className="btn btn-primary">
                Start syncing free
              </Link>
              <Link href="/#library" className="btn btn-secondary">
                Browse the library
              </Link>
            </div>
            <p
              className="mt-6.5 text-xs text-[color:var(--color-text-dim)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Exports .lrc · LRCLIB-compatible API
            </p>
          </div>
          <div>
            <LyricsDemo />
          </div>
        </div>
      </section>

      {/* Library / search */}
      <section id="library" className="scroll-mt-6 border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <p className="klr-eyebrow">THE LIBRARY</p>
          <h2
            className="mb-3 mt-2.5 text-[32px] font-bold tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Find a song, sing it tonight
          </h2>
          <p className="mb-7 text-[15px] text-[color:var(--color-text-muted)]">
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {lyricsStats.n.toLocaleString("en-US")}
            </span>{" "}
            {lyricsStats.n === 1 ? "song has" : "songs have"} karaoke lyrics ready to sing.
          </p>
          <SearchBox />

          {mostUsed.length > 0 && (
            <div className="mt-12">
              <p className="klr-eyebrow !text-[11px]">MOST SUNG</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {mostUsed.map((t) => (
                  <Link
                    key={t.id}
                    href={`/track/${t.id}`}
                    className="klr-card group flex flex-col gap-3 p-4 transition-colors hover:border-white/15"
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate font-medium transition-colors group-hover:text-[color:var(--klr-hi)]"
                        title={t.trackName}
                      >
                        {t.trackName}
                      </p>
                      <p
                        className="mt-0.5 truncate text-sm text-[color:var(--color-text-muted)]"
                        title={t.artistName}
                      >
                        {t.artistName}
                      </p>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <TierBadge tier={t.bestTier} />
                      {t.bestHasWordTiming && <WordSyncBadge />}
                      <span
                        className="ml-auto text-[11px] text-[color:var(--color-text-dim)]"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {t.singers > 0
                          ? `${t.singers} ${t.singers === 1 ? "singer" : "singers"}`
                          : "new"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {mostWanted.length > 0 && (
            <div className="mt-12">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="klr-eyebrow !text-[11px]">MOST WANTED</p>
                  <p className="mt-1.5 text-sm text-[color:var(--color-text-muted)]">
                    Songs people are waiting on. Play one with Karafilt and you help time it.
                  </p>
                </div>
                <Link
                  href="/queue"
                  className="text-sm text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
                >
                  The whole queue →
                </Link>
              </div>
              <WantedList songs={mostWanted} />
            </div>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-18">
          <p className="klr-eyebrow">THE STUDIO</p>
          <h2
            className="mb-8 mt-2.5 text-[32px] font-bold tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Syncing, without the spreadsheet feeling
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="klr-card p-6">
                <div
                  className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px]"
                  style={{ background: "color-mix(in srgb, var(--klr-b) 12%, transparent)" }}
                >
                  {f.icon}
                </div>
                <h3 className="mt-4 text-[17px] font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-text-muted)]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works + stats */}
      <section className="border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 pb-18 pt-16">
          <p className="klr-eyebrow mb-7">HOW IT WORKS</p>
          <div className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="border-t border-white/10 pt-4.5">
                <p className="text-[13px] text-[color:var(--klr-b)]" style={{ fontFamily: "var(--font-mono)" }}>
                  {s.n}
                </p>
                <h3 className="mt-2.5 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-text-muted)]">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-11 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="TRACKS IN THE LIBRARY"
              value={trackStats.n.toLocaleString("en-US")}
              hint="Every duration is its own track"
            />
            <StatCard
              label="LYRIC REVISIONS"
              value={revisionStats.n.toLocaleString("en-US")}
              hint="Immutable — nothing is ever overwritten"
            />
            <StatCard
              label="CONTRIBUTORS"
              value={revisionStats.contributors.toLocaleString("en-US")}
              hint="Anonymous, salted hashes only"
            />
          </div>
        </div>
      </section>

      {/* Community: GitHub contributors, the same section karafilt.com has */}
      {contributors.length > 0 && (
        <section id="contributors" className="scroll-mt-6 border-t border-white/5">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <p className="klr-eyebrow">THE COMMUNITY</p>
            <h2
              className="mb-3 mt-2.5 text-[32px] font-bold tracking-[-0.02em]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Thanks to our community
            </h2>
            <p className="mb-7 text-[15px] text-[color:var(--color-text-muted)]">
              Karalyr is open source and kept alive by the people who build it.
            </p>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h3 className="text-lg font-semibold">Contributors</h3>
              <Link
                href="/contributors"
                className="text-sm text-[color:var(--klr-b)] transition-colors hover:text-[color:var(--color-text)]"
              >
                See all contributors →
              </Link>
            </div>
            <ContributorsGrid contributors={contributors} limit={8} />
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-white/5">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(640px 300px at 50% 100%, color-mix(in srgb, var(--klr-b) 9%, transparent), transparent 70%)",
          }}
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 py-22 text-center">
          <div
            className="h-11 w-10"
            style={{ filter: "drop-shadow(0 10px 30px color-mix(in srgb, var(--klr-b) 40%, transparent))" }}
          >
            <KaralyrMark />
          </div>
          <h2
            className="mt-6 max-w-xl text-4xl font-bold tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Your favorite song is missing its lyrics.
          </h2>
          <p className="mt-3.5 text-base text-[color:var(--color-text-muted)]">
            Be the one who syncs it.
          </p>
          <div className="mt-7">
            <Link href="/contribute" className="btn btn-primary">
              Open the Studio
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
