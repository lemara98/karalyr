"use client";

import { useState } from "react";
import { TierBadge } from "./TierBadge";
import type { Source, Tier } from "@/lib/db/schema";

interface RevisionRow {
  id: number;
  source: Source;
  tier: Tier;
  status: string;
  parent_revision_id: number | null;
  created_at: number;
  submitter: string;
}

export function RevisionList({ trackId }: { trackId: number }) {
  const [rows, setRows] = useState<RevisionRow[] | null>(null);
  const [bestId, setBestId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  async function toggle() {
    if (!open && rows === null) {
      const res = await fetch(`/api/track/${trackId}/revisions`);
      if (res.ok) {
        const body = await res.json();
        setRows(body.revisions);
        setBestId(body.best_revision_id);
      }
    }
    setOpen(!open);
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {open ? "Hide revisions" : "View revisions"}
      </button>
      {open && rows && (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 pr-3">#</th>
              <th className="py-1 pr-3">source</th>
              <th className="py-1 pr-3">tier</th>
              <th className="py-1 pr-3">status</th>
              <th className="py-1 pr-3">submitter</th>
              <th className="py-1">created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.id} className={r.id === bestId ? "font-medium" : undefined}>
                <td className="py-1.5 pr-3">
                  {r.id}
                  {r.id === bestId && (
                    <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">
                      ← serving
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  {r.source}
                  {r.parent_revision_id && (
                    <span className="text-xs text-zinc-500"> (of #{r.parent_revision_id})</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  <TierBadge tier={r.tier} />
                </td>
                <td className="py-1.5 pr-3">{r.status}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{r.submitter}</td>
                <td className="py-1.5 text-xs text-zinc-500">
                  {new Date(r.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
