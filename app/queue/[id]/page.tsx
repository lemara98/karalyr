import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getWantedSongDetail } from "@/lib/db/queries";
import { SYNC_JOB_ACTIVE_STATUSES } from "@/lib/db/schema";
import { parseVideoKey } from "@/lib/video-key";
import { QueueComments } from "@/components/QueueComments";
import { QueueVoteButton } from "@/components/QueueVoteButton";
import { SpotifyEmbed } from "@/components/SpotifyEmbed";
import { YouTubeEmbed } from "@/components/YouTubeEmbed";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Same status colors as the admin panel's chip. */
function StatusChip({ status }: { status: string }) {
  const color =
    status === "done"
      ? "text-[color:var(--klr-hi)]"
      : status === "failed"
        ? "text-red-400"
        : status === "rejected" || status === "cancelled"
          ? "text-red-300"
          : status === "processing"
            ? "text-[color:var(--klr-a)]"
            : "text-[color:var(--color-text-dim)]";
  return (
    <span
      className={`rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider ${color}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (!Number.isFinite(jobId)) return {};
  const detail = await getWantedSongDetail(getDb(), jobId);
  if (!detail) return {};
  return { title: `${detail.job.trackName} — ${detail.job.artistName} — Karalyr` };
}

export default async function QueueCandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (!Number.isFinite(jobId)) notFound();

  const detail = await getWantedSongDetail(getDb(), jobId);
  if (!detail) notFound();
  const { job, voters, sources, libraryTrackId } = detail;

  const active = (SYNC_JOB_ACTIVE_STATUSES as readonly string[]).includes(job.status);
  const video = parseVideoKey(job.videoKey);
  // Everyone else's links, minus the one already embedded above.
  const alternates = [
    ...new Map(
      sources.filter((s) => s.videoKey !== job.videoKey).map((s) => [s.videoKey, s])
    ).values(),
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <div>
        <p className="klr-eyebrow">QUEUE CANDIDATE</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1
            className="text-3xl font-bold tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {job.trackName}
          </h1>
          <StatusChip status={job.status} />
        </div>
        <p className="mt-1.5 text-[color:var(--color-text-muted)]">
          {job.artistName}
          {job.albumName && <> · {job.albumName}</>}
          {job.durationSeconds != null && (
            <>
              {" "}
              ·{" "}
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {formatDuration(job.durationSeconds)}
              </span>
            </>
          )}
        </p>
        <p className="mt-1.5 text-sm text-[color:var(--color-text-dim)]">
          Requested by {job.submitterName ?? "Anonymous"} ·{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {voters} {voters === 1 ? "want" : "wants"}
          </span>{" "}
          · {new Date(job.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {active && <QueueVoteButton jobId={job.id} nextPath={`/queue/${job.id}`} />}
        {job.status === "done" && job.resultTrackId != null && (
          <Link href={`/track/${job.resultTrackId}`} className="btn btn-primary btn-sm">
            Now in the library →
          </Link>
        )}
        {job.status === "rejected" && (
          <p className="text-sm text-red-300">
            This request was rejected{job.rejectionReason ? <>: {job.rejectionReason}</> : "."}
          </p>
        )}
        {(job.status === "failed" || job.status === "cancelled") && (
          <p className="text-sm text-[color:var(--color-text-muted)]">
            This request is closed ({job.status}). Asking again in the Studio reopens the song.
          </p>
        )}
        {libraryTrackId != null && job.status !== "done" && (
          <Link
            href={`/track/${libraryTrackId}`}
            className="text-sm text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
          >
            In the library — no word timing yet
          </Link>
        )}
      </div>

      {video?.platform === "youtube" && <YouTubeEmbed videoId={video.id} />}
      {video?.platform === "spotify" && <SpotifyEmbed spotifyTrackId={video.id} />}
      {!video && job.videoUrl && (
        <a
          href={job.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[color:var(--klr-b)] underline decoration-dotted underline-offset-2 hover:no-underline"
        >
          Listen ↗
        </a>
      )}

      <div className="klr-card p-5">
        <p className="klr-eyebrow mb-3 !text-[11px]">SUBMITTED LYRICS</p>
        <p className="max-h-[28rem] overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-[color:var(--color-text-muted)]">
          {job.plainLyrics}
        </p>
      </div>

      {alternates.length > 0 && (
        <div>
          <p className="klr-eyebrow mb-2 !text-[11px]">ALSO OFFERED ON</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {alternates.map((s) => (
              <li key={s.videoKey}>
                <a
                  href={s.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {s.videoKey} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <QueueComments jobId={job.id} />
    </div>
  );
}
