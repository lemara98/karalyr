import { eq } from "drizzle-orm";
import { Contribute, type ContributeInitial } from "@/components/Contribute";
import { getDb } from "@/lib/db/client";
import { revisions, tracks } from "@/lib/db/schema";
import { payloadToSyncedLyrics, validatePayload } from "@/lib/formats";
import { localAlignAvailable } from "@/lib/align-local";

export const dynamic = "force-dynamic";

/**
 * ?track=<id> opens the Studio prefilled with that track's current best
 * lyrics (as Enhanced LRC), so wrong words can be fixed in place. Publishing
 * then creates a correction revision chained to the one being fixed.
 */
async function loadInitial(trackParam: string | undefined): Promise<ContributeInitial | undefined> {
  const trackId = parseInt(trackParam ?? "", 10);
  if (!Number.isFinite(trackId)) return undefined;

  const db = getDb();
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track?.bestRevisionId) return undefined;
  const [best] = await db.select().from(revisions).where(eq(revisions.id, track.bestRevisionId));
  if (!best) return undefined;

  return {
    trackId: track.id,
    artist: track.artistName,
    title: track.trackName,
    album: track.albumName ?? "",
    duration: String(track.durationSeconds),
    raw: payloadToSyncedLyrics(validatePayload(JSON.parse(best.payload)), { syllables: true }),
    parentRevisionId: best.id,
  };
}

export default async function ContributePage({
  searchParams,
}: {
  searchParams: Promise<{ track?: string }>;
}) {
  const { track } = await searchParams;
  const initial = await loadInitial(track);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <p className="klr-eyebrow">THE STUDIO</p>
      <h1
        className="mt-2 text-3xl font-bold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {initial ? "Fix a song" : "Sync a song"}
      </h1>
      <p className="mb-7 mt-2 text-sm text-[color:var(--color-text-muted)]">
        {initial ? (
          <>
            The current lyrics of{" "}
            <span className="text-[color:var(--color-text)]">
              {initial.artist} — {initial.title}
            </span>{" "}
            are loaded below. Correct the words or timing and publish — your fix becomes a
            new correction revision; the original is never overwritten.
          </>
        ) : (
          <>
            Paste a word-synced Enhanced LRC / UltraStar file, or request an AI word-sync
            from a YouTube link. Every submission becomes a new revision — nothing is
            overwritten.
          </>
        )}
      </p>
      <Contribute aiAlignEnabled={localAlignAvailable()} initial={initial} />
    </div>
  );
}
