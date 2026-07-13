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
      <button onClick={toggle} className="btn btn-ghost btn-sm">
        {open ? "Hide revisions" : "View revisions"}
      </button>
      {open && rows && (
        <div className="klr-card mt-3 overflow-x-auto px-4 py-2">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-[color:var(--color-text-dim)]">
              <tr>
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">source</th>
                <th className="py-2 pr-3 font-medium">tier</th>
                <th className="py-2 pr-3 font-medium">status</th>
                <th className="py-2 pr-3 font-medium">submitter</th>
                <th className="py-2 font-medium">created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.id} className={r.id === bestId ? "font-medium" : undefined}>
                  <td className="py-2 pr-3">
                    {r.id}
                    {r.id === bestId && (
                      <span className="ml-1.5 text-[11px] text-[color:var(--klr-hi)]">
                        ← serving
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {r.source}
                    {r.parent_revision_id && (
                      <span className="text-xs text-[color:var(--color-text-dim)]">
                        {" "}
                        (of #{r.parent_revision_id})
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <TierBadge tier={r.tier} />
                  </td>
                  <td className="py-2 pr-3 text-[color:var(--color-text-muted)]">{r.status}</td>
                  <td className="py-2 pr-3 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                    {r.submitter}
                  </td>
                  <td className="py-2 text-xs text-[color:var(--color-text-dim)]">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
