"use client";

import { useCallback, useEffect, useState } from "react";
import { TierBadge } from "./TierBadge";
import type { Source, Tier } from "@/lib/db/schema";
import type { LyricsPayload } from "@/lib/formats/types";

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
  return other.lines.some((l) => l.text === line) ? "" : "bg-amber-100 dark:bg-amber-950";
}

export function AdminPanel() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revertId, setRevertId] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/pending");
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    const body = await res.json();
    setItems(body.items);
  }, []);

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

  if (authed === null) return <p className="text-sm text-zinc-500">Loading…</p>;

  if (!authed) {
    return (
      <form onSubmit={login} className="flex max-w-sm gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Unlock
        </button>
        {message && <p className="text-sm text-red-600">{message}</p>}
      </form>
    );
  }

  const btn =
    "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

  return (
    <div className="space-y-8">
      {message && <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p>}

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Pending review {items && <span className="text-zinc-500">({items.length})</span>}
        </h2>
        {items?.length === 0 && <p className="text-sm text-zinc-500">Queue is empty.</p>}
        <div className="space-y-6">
          {items?.map((item) => (
            <div
              key={item.revision.id}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">
                    {item.track.artistName} — {item.track.trackName}
                  </span>
                  <span className="ml-2 text-sm text-zinc-500">
                    revision #{item.revision.id} ({item.revision.source}
                    {item.revision.parent_revision_id &&
                      ` of #${item.revision.parent_revision_id}`}
                    ) · {new Date(item.revision.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    className={`${btn} text-emerald-700 dark:text-emerald-400`}
                    onClick={() => moderate(item.revision.id, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className={`${btn} text-red-700 dark:text-red-400`}
                    onClick={() => moderate(item.revision.id, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="min-w-0 flex-1">
                  <h4 className="mb-1 text-xs font-semibold uppercase text-zinc-500">
                    Current best{" "}
                    {item.current_best && <TierBadge tier={item.current_best.tier} />}
                  </h4>
                  <div className="max-h-64 overflow-y-auto rounded border border-zinc-200 p-2 font-mono text-xs dark:border-zinc-800">
                    {item.current_best ? (
                      item.current_best.payload.lines.map((l, i) => (
                        <p key={i} className={diffClass(l.text, item.revision.payload)}>
                          <span className="text-zinc-400">{(l.start_ms / 1000).toFixed(2)}s </span>
                          {l.text}
                        </p>
                      ))
                    ) : (
                      <p className="text-zinc-400">none</p>
                    )}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="mb-1 text-xs font-semibold uppercase text-zinc-500">
                    Proposed <TierBadge tier={item.revision.tier} />
                  </h4>
                  <div className="max-h-64 overflow-y-auto rounded border border-zinc-200 p-2 font-mono text-xs dark:border-zinc-800">
                    {item.revision.payload.lines.map((l, i) => (
                      <p key={i} className={diffClass(l.text, item.current_best?.payload ?? null)}>
                        <span className="text-zinc-400">{(l.start_ms / 1000).toFixed(2)}s </span>
                        {l.text}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Revert to revision</h2>
        <p className="mb-2 text-sm text-zinc-500">
          Retires every newer active revision of the same track so the given
          revision is served again. Find revision ids via “View revisions” on
          a track page.
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
            className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button className={btn}>Revert</button>
        </form>
      </section>
    </div>
  );
}
