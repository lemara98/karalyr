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
