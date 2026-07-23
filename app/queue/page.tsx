import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { searchWantedSongs } from "@/lib/db/queries";
import { WantedList } from "@/components/WantedList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The queue — Karalyr",
  description: "Songs waiting for word-timed karaoke lyrics — search them, back them, discuss them.",
};

const PER_PAGE = 20;

/** /queue?q=...&page=N — omits defaults so bare /queue stays canonical. */
function queueHref(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/queue?${qs}` : "/queue";
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 200);
  const requestedPage = Math.max(1, Math.floor(parseInt(sp.page ?? "1", 10)) || 1);

  const { songs, total, page } = await searchWantedSongs(getDb(), {
    q,
    page: requestedPage,
    perPage: PER_PAGE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="mx-auto max-w-4xl space-y-12 px-6 py-10">
      <div>
        <p className="klr-eyebrow">THE QUEUE</p>
        <h1
          className="mt-2 text-3xl font-bold tracking-[-0.02em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Songs waiting for word timing
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-text-muted)]">
          Every song here has lyrics but no word-by-word timing yet. Asking for one tells us
          what to work on next — the more people who want a song, the higher it climbs.
        </p>
      </div>

      <section className="space-y-4">
        <form action="/queue" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder="Search by artist, title, album or a lyrics line…"
            className="field !w-auto min-w-0 flex-1"
          />
          <button type="submit" className="btn btn-secondary btn-sm">
            Search
          </button>
          {q && (
            <Link
              href="/queue"
              className="text-sm text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
            >
              Clear ×
            </Link>
          )}
        </form>

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {q
              ? `${total} ${total === 1 ? "song matches" : "songs match"} “${q}”`
              : total > 0
                ? `${total} waiting`
                : "Nothing waiting"}
          </h2>
          <Link
            href="/contribute"
            className="text-sm text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
          >
            Request a song →
          </Link>
        </div>

        {songs.length > 0 || !q ? (
          <WantedList songs={songs} startRank={(page - 1) * PER_PAGE + 1} />
        ) : (
          <p className="text-sm text-[color:var(--color-text-muted)]">
            No open requests match — try fewer words, or a line from the lyrics.
          </p>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 pt-2">
            {page > 1 ? (
              <Link href={queueHref(q, page - 1)} className="btn btn-secondary btn-sm">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span
              className="text-xs text-[color:var(--color-text-dim)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={queueHref(q, page + 1)} className="btn btn-secondary btn-sm">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Adding a song</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="klr-card space-y-2 p-5">
            <p className="klr-eyebrow !text-[11px]">AUTOMATIC</p>
            <h3 className="font-medium">Install Karafilt</h3>
            <p className="text-sm text-[color:var(--color-text-muted)]">
              Play music as you normally would. When a song has lyrics but no word timing,
              the extension adds it here for you — nothing to fill in.
            </p>
            <p className="text-sm text-[color:var(--color-text-muted)]">
              It also times songs while you listen, so playing something in the queue is the
              fastest way to get it done.
            </p>
          </div>

          <div className="klr-card space-y-2 p-5">
            <p className="klr-eyebrow !text-[11px]">BY HAND</p>
            <h3 className="font-medium">Ask in the Studio</h3>
            <p className="text-sm text-[color:var(--color-text-muted)]">
              Paste the artist, title and the lyrics. A link to where the song plays is
              optional, but it helps — it makes the request traceable to the right recording.
            </p>
            <Link href="/contribute" className="btn btn-secondary btn-sm">
              Open the Studio
            </Link>
          </div>
        </div>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Requesting needs a free Karafilt account, the same one that works on{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>karafilt.com</span>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What happens next</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-[color:var(--color-text-muted)]">
          <li>
            <strong className="font-medium text-[color:var(--color-text)]">
              People listening does most of it.
            </strong>{" "}
            Karafilt times lines while the song plays, and those timings are pooled across
            everyone who plays it. Popular requests finish on their own.
          </li>
          <li>
            <strong className="font-medium text-[color:var(--color-text)]">
              Some get aligned directly.
            </strong>{" "}
            Requests can also be run through the offline aligner for tighter timing.
          </li>
          <li>
            <strong className="font-medium text-[color:var(--color-text)]">
              The result is a normal revision.
            </strong>{" "}
            It arrives word-synced at the <code>auto_aligned</code> tier, so corrections and
            votes still apply — and the request closes itself.
          </li>
        </ul>
      </section>
    </div>
  );
}
