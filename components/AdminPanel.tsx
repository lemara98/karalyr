"use client";

import { useCallback, useEffect, useState } from "react";
import { TierBadge } from "./TierBadge";
import type { Source, Tier } from "@/lib/db/schema";
import type { LyricsPayload } from "@/lib/formats/types";

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

interface SyncJob {
  id: number;
  source: "extension" | "website";
  status: string;
  video_key: string;
  video_url: string;
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
  const [token, setToken] = useState("");
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [comments, setComments] = useState<AdminComment[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revertId, setRevertId] = useState("");
  const [syncPending, setSyncPending] = useState<SyncJob[] | null>(null);
  const [syncActive, setSyncActive] = useState<SyncJob[] | null>(null);
  const [syncRecent, setSyncRecent] = useState<SyncJob[] | null>(null);
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadSync = useCallback(async () => {
    const [pending, active, recent] = await Promise.all(
      (["pending", "active", "recent"] as const).map(async (status) => {
        const res = await fetch(`/api/admin/sync-queue?status=${status}`).catch(() => null);
        if (!res?.ok) return null;
        const body = await res.json().catch(() => ({}));
        return (body.jobs ?? null) as SyncJob[] | null;
      })
    );
    setSyncPending(pending);
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
  }, [loadSync]);

  useEffect(() => {
    load();
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      setToken("");
      load();
    } else {
      setMessage("Invalid token");
    }
  }

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
    action: "approve" | "reject" | "cancel" | "retry",
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

  if (authed === null) {
    return <p className="text-sm text-[color:var(--color-text-dim)]">Loading…</p>;
  }

  if (!authed) {
    return (
      <div className="max-w-sm space-y-2">
        <form onSubmit={login} className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Admin token"
            className="field flex-1"
          />
          <button className="btn btn-primary btn-sm">Unlock</button>
        </form>
        {message && <p className="text-sm text-red-400">{message}</p>}
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
            Sync queue{" "}
            {syncPending && (
              <span className="text-[color:var(--color-text-dim)]">
                ({syncPending.length} awaiting approval)
              </span>
            )}
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={() => loadSync()}>
            Refresh
          </button>
        </div>

        {syncPending?.length === 0 && (
          <p className="text-sm text-[color:var(--color-text-dim)]">
            No sync requests awaiting approval.
          </p>
        )}
        <div className="space-y-4">
          {syncPending?.map((j) => (
            <div key={j.id} className="klr-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium">
                    {j.artist_name} — {j.track_name}
                  </span>{" "}
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[color:var(--klr-a)]">
                    {j.source}
                  </span>
                  <span className="ml-2 text-sm text-[color:var(--color-text-dim)]">
                    job #{j.id} ·{" "}
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
                        onClick={() => moderateSync(j.id, "approve")}
                      >
                        Approve
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
                    </>
                  )}
                </div>
              </div>
              <p className="truncate text-xs">
                <a
                  href={j.video_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[color:var(--klr-b)] hover:underline"
                >
                  {j.video_url}
                </a>
              </p>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-[color:var(--color-text-dim)]">
                  Lyrics preview ({j.line_count} lines)
                </summary>
                <div
                  className="mt-1.5 rounded-xl border border-white/10 bg-black/20 p-2.5"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {j.lyrics_preview.map((line, i) => (
                    <p key={i} className="px-1 py-px">
                      {line || " "}
                    </p>
                  ))}
                  {j.line_count > j.lyrics_preview.length && (
                    <p className="px-1 py-px text-[color:var(--color-text-dim)]">
                      … {j.line_count - j.lyrics_preview.length} more lines
                    </p>
                  )}
                </div>
              </details>
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
