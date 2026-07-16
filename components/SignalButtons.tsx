"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReportLyricsDialog } from "@/components/ReportLyricsDialog";

export function SignalButtons({ revisionId }: { revisionId: number }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [offset, setOffset] = useState("");

  async function send(type: string, value?: number) {
    setMessage(null);
    const res = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision_id: revisionId, type, value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.message ?? "Something went wrong");
      return;
    }
    if (body.promoted) {
      setMessage("Thanks! This revision was promoted a tier.");
    } else if (body.correction_revision_id) {
      setMessage("Thanks! Enough offset reports agreed — an auto-corrected revision was created.");
    } else {
      setMessage("Thanks for the feedback!");
    }
    router.refresh();
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-secondary btn-sm" onClick={() => send("explicit_up")} title="Timing is good">
          👍 Good timing
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => send("explicit_down")} title="Timing is off">
          👎 Bad timing
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => send("clean_playthrough")}
          title="Sang through with no issues"
        >
          ✅ Clean playthrough
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOffsetOpen(!offsetOpen)}>
          ⏱ Report timing offset
        </button>
        <ReportLyricsDialog revisionId={revisionId} />
      </div>
      {offsetOpen && (
        <form
          className="flex flex-wrap items-center gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const value = parseInt(offset, 10);
            if (Number.isFinite(value)) send("offset_correction", value);
          }}
        >
          <input
            type="number"
            step={10}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            placeholder="+250"
            className="field !w-28"
            style={{ fontFamily: "var(--font-mono)" }}
          />
          <span className="text-[color:var(--color-text-dim)]">
            ms (positive = lyrics should appear later)
          </span>
          <button type="submit" className="btn btn-secondary btn-sm">
            Send
          </button>
        </form>
      )}
      {message && <p className="text-sm text-[color:var(--color-text-muted)]">{message}</p>}
    </div>
  );
}
