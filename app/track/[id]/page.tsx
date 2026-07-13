import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { revisions, tracks } from "@/lib/db/schema";
import { validatePayload } from "@/lib/formats";
import { ExportButtons } from "@/components/ExportButtons";
import { LyricsPlayer } from "@/components/LyricsPlayer";
import { RevisionList } from "@/components/RevisionList";
import { SignalButtons } from "@/components/SignalButtons";
import { TierBadge } from "@/components/TierBadge";

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

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="text-3xl font-bold tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {track.trackName}
          </h1>
          <TierBadge tier={best?.tier ?? null} />
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
          <LyricsPlayer payload={payload} durationSeconds={track.durationSeconds} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SignalButtons revisionId={best.id} />
            <ExportButtons
              payload={payload}
              baseName={`${track.artistName} - ${track.trackName}`}
            />
          </div>
        </>
      ) : (
        <p className="text-[color:var(--color-text-muted)]">No lyrics yet for this track.</p>
      )}

      <RevisionList trackId={track.id} />
    </div>
  );
}
