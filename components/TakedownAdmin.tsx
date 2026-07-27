"use client";

import { useCallback, useEffect, useState } from "react";

interface Notice {
  id: number;
  status: "received" | "actioned" | "declined" | "withdrawn";
  claimantName: string;
  claimantEmail: string;
  claimantOrg: string | null;
  claimantRole: string;
  workDescription: string;
  complainedOf: string;
  trackId: number | null;
  removedRevisionIds: string;
  resolution: string | null;
  actionedBy: string | null;
  actionedAt: number | null;
  createdAt: number;
}

const STATUS_CLS: Record<Notice["status"], string> = {
  received: "text-[color:var(--klr-a)]",
  actioned: "text-[color:var(--klr-hi)]",
  declined: "text-[color:var(--color-text-dim)]",
  withdrawn: "text-[color:var(--color-text-dim)]",
};

function StatusChip({ status }: { status: Notice["status"] }) {
  return (
    <span
      className={`rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_CLS[status]}`}
    >
      {status}
    </span>
  );
}

export function TakedownAdmin() {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/takedown");
    if (res.ok) setNotices((await res.json()).notices);
    else setError(`Failed to load notices (${res.status})`);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/takedown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b?.message ?? `Action failed (${res.status})`);
    }
    setBusy(false);
    await load();
  }

  async function remove(notice: Notice) {
    const raw = prompt(
      `Revision ids to purge for notice #${notice.id}, comma-separated.\n\n` +
        `This is IRREVERSIBLE — the lyric payloads are overwritten, not hidden.`
    );
    if (!raw) return;
    const ids = raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return setError("No valid revision ids given");
    const resolution = prompt("Note for the record (what you removed and why):") ?? "";
    await act({ action: "remove", notice_id: notice.id, revision_ids: ids, resolution });
  }

  async function decline(notice: Notice) {
    const resolution = prompt(`Why is notice #${notice.id} being declined? (required)`);
    if (!resolution?.trim()) return;
    await act({ action: "decline", notice_id: notice.id, resolution });
  }

  async function block() {
    const fingerprint = prompt("Submitter fingerprint to block (from the revision list):");
    if (!fingerprint?.trim()) return;
    const reason = prompt("Reason (recorded, required):");
    if (!reason?.trim()) return;
    await act({ action: "block", fingerprint: fingerprint.trim(), reason });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={block} disabled={busy} className="btn btn-secondary btn-sm">
          Block a submitter
        </button>
        <button onClick={load} disabled={busy} className="btn btn-secondary btn-sm">
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notices === null && <p className="text-sm text-[color:var(--color-text-dim)]">Loading…</p>}
      {notices?.length === 0 && (
        <p className="text-sm text-[color:var(--color-text-dim)]">No notices. Good.</p>
      )}

      {notices?.map((n) => {
        const removed: number[] = JSON.parse(n.removedRevisionIds || "[]");
        return (
          <div key={n.id} className="klr-card space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span style={{ fontFamily: "var(--font-mono)" }} className="text-sm">
                #{n.id}
              </span>
              <StatusChip status={n.status} />
              <span className="text-xs text-[color:var(--color-text-dim)]">
                {new Date(n.createdAt).toLocaleString()}
              </span>
            </div>

            <div className="text-sm">
              <p>
                <span className="font-medium">{n.claimantName}</span>
                {n.claimantOrg && <span className="text-[color:var(--color-text-muted)]"> · {n.claimantOrg}</span>}
                <span className="text-[color:var(--color-text-dim)]"> — {n.claimantRole}</span>
              </p>
              <a href={`mailto:${n.claimantEmail}`} className="text-xs text-[color:var(--klr-b)] hover:underline">
                {n.claimantEmail}
              </a>
            </div>

            <div className="space-y-1.5 text-sm text-[color:var(--color-text-muted)]">
              <p>
                <span className="text-[color:var(--color-text-dim)]">Work: </span>
                {n.workDescription}
              </p>
              <p className="whitespace-pre-wrap break-words">
                <span className="text-[color:var(--color-text-dim)]">Complained of: </span>
                {n.complainedOf}
              </p>
            </div>

            {n.status === "received" ? (
              <div className="flex flex-wrap gap-2.5">
                <button onClick={() => remove(n)} disabled={busy} className="btn btn-primary btn-sm">
                  Remove revisions…
                </button>
                <button onClick={() => decline(n)} disabled={busy} className="btn btn-secondary btn-sm">
                  Decline…
                </button>
              </div>
            ) : (
              <div className="border-t border-white/5 pt-3 text-xs text-[color:var(--color-text-dim)]">
                {removed.length > 0 && (
                  <p>
                    Purged revisions{" "}
                    <span style={{ fontFamily: "var(--font-mono)" }}>{removed.join(", ")}</span>
                  </p>
                )}
                {n.resolution && <p className="mt-1">{n.resolution}</p>}
                <p className="mt-1">
                  {n.actionedBy} · {n.actionedAt ? new Date(n.actionedAt).toLocaleString() : "—"}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
