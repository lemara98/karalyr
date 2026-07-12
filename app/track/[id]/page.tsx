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
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{track.trackName}</h1>
          <TierBadge tier={best?.tier ?? null} />
        </div>
        <p className="text-zinc-500">
          {track.artistName}
          {track.albumName && <> · {track.albumName}</>} ·{" "}
          {formatDuration(track.durationSeconds)}
          {best && (
            <span className="ml-2 text-xs">
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
        <p className="text-zinc-500">No lyrics yet for this track.</p>
      )}

      <RevisionList trackId={track.id} />
    </div>
  );
}
