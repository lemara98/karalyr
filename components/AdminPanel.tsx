"use client";

import { useCallback, useEffect, useState } from "react";
import { TierBadge } from "./TierBadge";
import type { Source, Tier } from "@/lib/db/schema";
import type { LyricsPayload } from "@/lib/formats/types";
import { parseVideoKey } from "@/lib/video-key";

interface AdminComment {
  id: number;
  track_id: number;
  artist_name: string;
  track_name: string;
  start_line: number;
  end_line: number;
  quote: string;
  body: string;
  author_name: string | null;
  author_user_id: string;
  created_at: number;
}

interface AdminJobComment {
  id: number;
  job_id: number;
  artist_name: string;
  track_name: string;
  status: string;
  body: string;
  author_name: string | null;
  author_user_id: string;
  created_at: number;
}

interface SyncSource {
  videoKey: string;
  videoUrl: string;
  createdAt: number;
}

/** The candidate's player, always visible — the moderation list is short. */
function JobEmbed({ videoKey, title }: { videoKey: string | null; title: string }) {
  const video = parseVideoKey(videoKey);
  if (!video) return null;
  return video.platform === "youtube" ? (
    <div className="relative aspect-video w-full max-w-md flex-none overflow-hidden rounded-xl border border-white/10">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0`}
        title={`YouTube — ${title}`}
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
        title={`Spotify — ${title}`}
        width="100%"
        height={152}
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        className="block"
        style={{ border: 0 }}
      />
    </div>
  );
}

interface SyncJob {
  id: number;
  source: "extension" | "website";
  status: string;
  video_key: string | null;
  video_url: string | null;
  /** Distinct people who asked for this song. */
  voters: number;
  /** Every link anyone offered, not just the display one. */
  sources: SyncSource[];
  artist_name: string;
  track_name: string;
  album_name: string | null;
  duration_seconds: number | null;
  plain_lyrics: string;
  submitter_user_id: string | null;
  submitter_name: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  rejection_reason: string | null;
  result_track_id: number | null;
  result_revision_id: number | null;
  created_at: number | string;
  updated_at: number | string;
  lyrics_preview: string[];
  line_count: number;
}

function SyncStatusChip({ status }: { status: string }) {
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

interface PendingItem {
  revision: {
    id: number;
    source: Source;
    tier: Tier;
    parent_revision_id: number | null;
    created_at: number;
    payload: LyricsPayload;
  };
  track: {
    id: number;
    artistName: string;
    trackName: string;
    albumName: string | null;
    durationSeconds: number;
  };
  current_best: { id: number; tier: Tier; source: Source; payload: LyricsPayload } | null;
}

/** Mark diff lines: text present in only one side. */
function diffClass(line: string, other: LyricsPayload | null): string {
  if (!other) return "";
  return other.lines.some((l) => l.text === line)
    ? ""
    : "rounded bg-[color:color-mix(in_srgb,var(--klr-b)_14%,transparent)]";
}

function DiffColumn({
  title,
  tier,
  payload,
  other,
}: {
  title: string;
  tier: Tier | null;
  payload: LyricsPayload | null;
  other: LyricsPayload | null;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">
        {title} {tier && <TierBadge tier={tier} />}
      </h4>
      <div
        className="max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2.5 text-xs"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {payload ? (
          payload.lines.map((l, i) => (
            <p key={i} className={`px-1 py-px ${diffClass(l.text, other)}`}>
              <span className="text-[color:var(--color-text-dim)]">
                {(l.start_ms / 1000).toFixed(2)}s{" "}
              </span>
              {l.singer && <span className="text-[color:var(--klr-a)]">[{l.singer}] </span>}
              {l.text}
            </p>
          ))
        ) : (
          <p className="text-[color:var(--color-text-dim)]">none</p>
        )}
      </div>
    </div>
  );
}

export function AdminPanel() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [comments, setComments] = useState<AdminComment[] | null>(null);
  const [jobComments, setJobComments] = useState<AdminJobComment[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revertId, setRevertId] = useState("");
  const [syncWanted, setSyncWanted] = useState<SyncJob[] | null>(null);
  const [syncActive, setSyncActive] = useState<SyncJob[] | null>(null);
  const [syncRecent, setSyncRecent] = useState<SyncJob[] | null>(null);
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadSync = useCallback(async () => {
    const [wantedJobs, active, recent] = await Promise.all(
      (["wanted", "active", "recent"] as const).map(async (status) => {
        const res = await fetch(`/api/admin/sync-queue?status=${status}`).catch(() => null);
        if (!res?.ok) return null;
        const body = await res.json().catch(() => ({}));
        return (body.jobs ?? null) as SyncJob[] | null;
      })
    );
    setSyncWanted(wantedJobs);
    setSyncActive(active);
    setSyncRecent(recent);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/pending");
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    const body = await res.json();
    setItems(body.items);

    loadSync();

    const commentsRes = await fetch("/api/admin/comments");
    if (commentsRes.ok) {
      const commentsBody = await commentsRes.json();
      setComments(commentsBody.comments);
    }

    const jobCommentsRes = await fetch("/api/admin/job-comments");
    if (jobCommentsRes.ok) {
      const jobCommentsBody = await jobCommentsRes.json();
      setJobComments(jobCommentsBody.comments);
    }
  }, [loadSync]);

  useEffect(() => {
    load();
  }, [load]);

  async function moderate(revisionId: number, action: "approve" | "reject" | "revert") {
    setMessage(null);
    const res = await fetch("/api/admin/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision_id: revisionId, action }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage(
      res.ok
        ? `${action} ok — best revision is now #${body.best_revision_id}`
        : body.message ?? "Action failed"
    );
    load();
  }

  async function moderateSync(
    jobId: number,
    action: "promote" | "approve" | "reject" | "cancel" | "retry",
    reason?: string
  ) {
    setMessage(null);
    const res = await fetch("/api/admin/sync-queue/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        action,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setMessage(`Sync job #${jobId} changed state in the meantime — refreshing…`);
    } else {
      setMessage(res.ok ? `Sync job #${jobId}: ${action} ok` : body.message ?? "Action failed");
    }
    setRejectTarget(null);
    setRejectReason("");
    loadSync();
  }

  async function deleteComment(commentId: number) {
    setMessage(null);
    const res = await fetch("/api/admin/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId, action: "delete" }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage(res.ok ? `Comment #${commentId} deleted` : body.message ?? "Delete failed");
    load();
  }

  async function saveLyricsEdit(jobId: number) {
    setMessage(null);
    setEditSaving(true);
    const res = await fetch("/api/admin/sync-queue/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, lyrics: editText }),
    });
    const body = await res.json().catch(() => ({}));
    setEditSaving(false);
    setMessage(
      res.ok
        ? `Sync job #${jobId}: lyrics corrected (${body.line_count} lines)`
        : body.message ?? "Edit failed"
    );
    if (res.ok) {
      setEditTarget(null);
      setEditText("");
    }
    loadSync();
  }

  async function deleteJobComment(commentId: number) {
    setMessage(null);
    const res = await fetch("/api/admin/job-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId, action: "delete" }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage(res.ok ? `Request comment #${commentId} deleted` : body.message ?? "Delete failed");
    load();
  }

  if (authed === null) {
    return <p className="text-sm text-[color:var(--color-text-dim)]">Loading…</p>;
  }

  // The page gates on admin status too; this covers a session expiring while
  // the panel is open.
  if (!authed) {
    return (
      <div className="max-w-sm space-y-3">
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Your session ended or your account no longer has moderator access.
        </p>
        <a href="/login?next=/admin" className="btn btn-secondary btn-sm">
          Sign in again
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {message && <p className="text-sm text-[color:var(--klr-hi)]">{message}</p>}

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Pending review{" "}
          {items && <span className="text-[color:var(--color-text-dim)]">({items.length})</span>}
        </h2>
        {items?.length === 0 && (
          <p className="text-sm text-[color:var(--color-text-dim)]">Queue is empty.</p>
        )}
        <div className="space-y-6">
          {items?.map((item) => (
            <div key={item.revision.id} className="klr-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-medium">
                    {item.track.artistName} — {item.track.trackName}
                  </span>
                  <span className="ml-2 text-sm text-[color:var(--color-text-dim)]">
                    revision #{item.revision.id} ({item.revision.source}
                    {item.revision.parent_revision_id &&
                      ` of #${item.revision.parent_revision_id}`}
                    ) · {new Date(item.revision.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => moderate(item.revision.id, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-secondary btn-sm !text-red-300"
                    onClick={() => moderate(item.revision.id, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-4 sm:flex-row">
                <DiffColumn
                  title="Current best"
                  tier={item.current_best?.tier ?? null}
                  payload={item.current_best?.payload ?? null}
                  other={item.revision.payload}
                />
                <DiffColumn
                  title="Proposed"
                  tier={item.revision.tier}
                  payload={item.revision.payload}
                  other={item.current_best?.payload ?? null}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">
            Wanted songs{" "}
            {syncWanted && (
              <span className="text-[color:var(--color-text-dim)]">
                ({syncWanted.length} requested)
              </span>
            )}
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={() => loadSync()}>
            Refresh
          </button>
        </div>

        <p className="mb-3 max-w-2xl text-sm text-[color:var(--color-text-dim)]">
          Demand only — nothing here is work yet. Promoting a song queues it for the aligner,
          so only promote once you have a lawful way to get its audio.
        </p>

        {syncWanted?.length === 0 && (
          <p className="text-sm text-[color:var(--color-text-dim)]">No songs requested.</p>
        )}
        <div className="space-y-4">
          {syncWanted?.map((j) => (
            <div key={j.id} className="klr-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={`/queue/${j.id}`}
                    className="font-medium text-[color:var(--klr-b)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
                    title="Open the candidate page — full lyrics, player, comments"
                  >
                    {j.artist_name} — {j.track_name} →
                  </a>{" "}
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[color:var(--klr-a)]">
                    {j.source}
                  </span>
                  <span className="ml-2 text-sm text-[color:var(--color-text-dim)]">
                    job #{j.id} · {j.voters} {j.voters === 1 ? "want" : "wants"} · first asked
                    by{" "}
                    {j.submitter_name ??
                      (j.submitter_user_id ? (
                        <span style={{ fontFamily: "var(--font-mono)" }}>
                          {j.submitter_user_id.slice(0, 8)}
                        </span>
                      ) : (
                        "unknown"
                      ))}{" "}
                    · {new Date(j.created_at).toLocaleString()}
                  </span>
                  {j.sources.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="text-[color:var(--color-text-dim)]">Sources:</span>
                      {j.sources.map((s) => (
                        <a
                          key={s.videoKey}
                          href={s.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
                          style={{ fontFamily: "var(--font-mono)" }}
                          title={s.videoUrl}
                        >
                          {s.videoKey} ↗
                        </a>
                      ))}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {rejectTarget === j.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        moderateSync(j.id, "reject", rejectReason);
                      }}
                    >
                      <input
                        className="field !w-48 !py-1.5"
                        placeholder="Reason (optional)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        autoFocus
                      />
                      <button className="btn btn-secondary btn-sm !text-red-300">
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setRejectTarget(null);
                          setRejectReason("");
                        }}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => moderateSync(j.id, "promote")}
                        title="Queue this for the aligner"
                      >
                        Promote to queue
                      </button>
                      <button
                        className="btn btn-secondary btn-sm !text-red-300"
                        onClick={() => {
                          setRejectTarget(j.id);
                          setRejectReason("");
                        }}
                      >
                        Reject
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setEditTarget(editTarget === j.id ? null : j.id);
                          setEditText(j.plain_lyrics);
                        }}
                        title="Correct the submitted lyrics before aligning"
                      >
                        {editTarget === j.id ? "Cancel edit" : "Edit lyrics"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="truncate text-xs">
                {j.video_url ? (
                  <a
                    href={j.video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[color:var(--klr-b)] hover:underline"
                  >
                    {j.video_url}
                  </a>
                ) : (
                  <span className="text-[color:var(--color-text-dim)]">
                    No link — asked for by artist and title
                  </span>
                )}
              </p>
              {/* Player + lyrics side by side, always visible — the same
                  at-a-glance layout the public queue previews use. The
                  lyrics column swaps for the correction editor when open. */}
              <div className="mt-3 flex flex-wrap gap-5">
                <JobEmbed videoKey={j.video_key} title={`${j.artist_name} — ${j.track_name}`} />
                {editTarget === j.id ? (
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="klr-eyebrow mb-1.5 !text-[10px]">CORRECT THE LYRICS</p>
                    <textarea
                      className="field min-h-56 w-full"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      disabled={editSaving}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => saveLyricsEdit(j.id)}
                        disabled={editSaving || editText.trim() === ""}
                      >
                        {editSaving ? "Saving…" : "Save correction"}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setEditTarget(null);
                          setEditText("");
                        }}
                        disabled={editSaving}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="klr-eyebrow mb-1.5 !text-[10px]">
                      LYRICS PREVIEW ({j.line_count} lines)
                    </p>
                    <p
                      className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--color-text-muted)]"
                      style={{
                        WebkitMaskImage: "linear-gradient(180deg, #000 60%, transparent)",
                        maskImage: "linear-gradient(180deg, #000 60%, transparent)",
                      }}
                    >
                      {j.lyrics_preview.join("\n")}
                    </p>
                    <a
                      href={`/queue/${j.id}`}
                      className="text-xs text-[color:var(--color-text-muted)] underline-offset-4 hover:text-[color:var(--klr-hi)] hover:underline"
                    >
                      {j.line_count > j.lyrics_preview.length
                        ? `All ${j.line_count} lines on the candidate page →`
                        : "Open the candidate page →"}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <h3 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">
          Queue status
        </h3>
        {syncActive && (
          <p className="mb-2 text-sm text-[color:var(--color-text-muted)]">
            {syncActive.filter((j) => j.status === "queued").length} queued ·{" "}
            {syncActive.filter((j) => j.status === "processing").length} processing
          </p>
        )}
        {syncActive?.length === 0 && (
          <p className="text-sm text-[color:var(--color-text-dim)]">Nothing in flight.</p>
        )}
        <div className="space-y-2">
          {syncActive?.map((j) => (
            <div
              key={j.id}
              className="klr-card flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-medium">
                  {j.artist_name} — {j.track_name}
                </span>{" "}
                <SyncStatusChip status={j.status} />
                <span className="ml-2 text-xs text-[color:var(--color-text-dim)]">
                  attempt {j.attempts}/{j.max_attempts} ·{" "}
                  {j.submitter_name ?? j.submitter_user_id?.slice(0, 8) ?? "unknown"}
                </span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => moderateSync(j.id, "cancel")}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>

        <h3 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">
          Recent
        </h3>
        {syncRecent?.length === 0 && (
          <p className="text-sm text-[color:var(--color-text-dim)]">No finished jobs yet.</p>
        )}
        <div className="space-y-2">
          {syncRecent?.map((j) => (
            <div
              key={j.id}
              className="klr-card flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-medium">
                  {j.artist_name} — {j.track_name}
                </span>{" "}
                <SyncStatusChip status={j.status} />
                {j.status === "failed" && j.last_error && (
                  <span className="ml-2 text-xs text-red-400" title={j.last_error}>
                    {j.last_error.length > 80 ? `${j.last_error.slice(0, 80)}…` : j.last_error}
                  </span>
                )}
                {j.status === "rejected" && j.rejection_reason && (
                  <span className="ml-2 text-xs text-red-300" title={j.rejection_reason}>
                    {j.rejection_reason.length > 80
                      ? `${j.rejection_reason.slice(0, 80)}…`
                      : j.rejection_reason}
                  </span>
                )}
              </div>
              {j.status === "failed" && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => moderateSync(j.id, "retry")}
                >
                  Retry
                </button>
              )}
              {j.status === "done" && j.result_track_id && (
                <a
                  href={`/track/${j.result_track_id}`}
                  className="text-sm text-[color:var(--klr-b)] hover:underline"
                >
                  View track →
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Lyric comments{" "}
          {comments && (
            <span className="text-[color:var(--color-text-dim)]">
              (latest {comments.length})
            </span>
          )}
        </h2>
        {comments?.length === 0 && (
          <p className="text-sm text-[color:var(--color-text-dim)]">No comments yet.</p>
        )}
        <div className="space-y-3">
          {comments?.map((c) => (
            <div key={c.id} className="klr-card flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <a
                    href={`/track/${c.track_id}`}
                    className="font-medium text-[color:var(--klr-b)] hover:underline"
                  >
                    {c.artist_name} — {c.track_name}
                  </a>
                  <span className="ml-2 text-xs text-[color:var(--color-text-dim)]">
                    lines {c.start_line + 1}–{c.end_line + 1} ·{" "}
                    {c.author_name ?? "Anonymous"}{" "}
                    <span style={{ fontFamily: "var(--font-mono)" }}>
                      ({c.author_user_id.slice(0, 8)})
                    </span>{" "}
                    · {new Date(c.created_at).toLocaleString()}
                  </span>
                </p>
                <blockquote
                  className="mt-1.5 truncate text-xs text-[color:var(--color-text-dim)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                  title={c.quote}
                >
                  {c.quote.replaceAll("\n", " / ")}
                </blockquote>
                <p className="mt-1 break-words text-sm" title={c.body}>
                  {c.body.length > 200 ? `${c.body.slice(0, 200)}…` : c.body}
                </p>
              </div>
              <button
                className="btn btn-secondary btn-sm !text-red-300"
                onClick={() => deleteComment(c.id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Request comments{" "}
          {jobComments && (
            <span className="text-[color:var(--color-text-dim)]">
              (latest {jobComments.length})
            </span>
          )}
        </h2>
        {jobComments?.length === 0 && (
          <p className="text-sm text-[color:var(--color-text-dim)]">No comments yet.</p>
        )}
        <div className="space-y-3">
          {jobComments?.map((c) => (
            <div key={c.id} className="klr-card flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <a
                    href={`/queue/${c.job_id}`}
                    className="font-medium text-[color:var(--klr-b)] hover:underline"
                  >
                    {c.artist_name} — {c.track_name}
                  </a>
                  <span className="ml-2 text-xs text-[color:var(--color-text-dim)]">
                    {c.status.replaceAll("_", " ")} · {c.author_name ?? "Anonymous"}{" "}
                    <span style={{ fontFamily: "var(--font-mono)" }}>
                      ({c.author_user_id.slice(0, 8)})
                    </span>{" "}
                    · {new Date(c.created_at).toLocaleString()}
                  </span>
                </p>
                <p className="mt-1 break-words text-sm" title={c.body}>
                  {c.body.length > 200 ? `${c.body.slice(0, 200)}…` : c.body}
                </p>
              </div>
              <button
                className="btn btn-secondary btn-sm !text-red-300"
                onClick={() => deleteJobComment(c.id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Revert to revision</h2>
        <p className="mb-3 text-sm text-[color:var(--color-text-muted)]">
          Retires every newer active revision of the same track so the given
          revision is served again. Find revision ids via “View revisions” on a
          track page.
        </p>
        <form
          className="flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const id = parseInt(revertId, 10);
            if (Number.isFinite(id)) moderate(id, "revert");
          }}
        >
          <input
            type="number"
            value={revertId}
            onChange={(e) => setRevertId(e.target.value)}
            placeholder="Revision id"
            className="field flex-1"
          />
          <button className="btn btn-secondary btn-sm">Revert</button>
        </form>
      </section>
    </div>
  );
}
