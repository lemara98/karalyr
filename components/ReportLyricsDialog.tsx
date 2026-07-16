"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_REPORT_NOTE_LENGTH,
  REPORT_REASONS,
  type ReportReason,
} from "@/lib/reports";

/**
 * "Report lyrics" control for the signal bar: flags that the lyrics *content*
 * is wrong (distinct from the timing-offset report). Opens a modal to collect
 * a reason + optional note and posts a content_report to /api/signal — the
 * same route and quality loop the other signals use.
 */
export function ReportLyricsDialog({ revisionId }: { revisionId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Reset the form each time it opens, focus the reason select, and wire Escape.
  useEffect(() => {
    if (!open) return;
    setReason("");
    setNote("");
    setStatus("idle");
    setError(null);
    const focus = setTimeout(() => selectRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(focus);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setStatus("sending");
    setError(null);
    const res = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision_id: revisionId,
        type: "content_report",
        reason,
        note: note.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.message ?? "Something went wrong");
      setStatus("idle");
      return;
    }
    setStatus("done");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen(true)}
        title="Report that the lyrics content is wrong"
      >
        🚩 Report lyrics
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(4, 6, 14, 0.66)", backdropFilter: "blur(4px)" }}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-lyrics-title"
            className="klr-card w-full max-w-md p-6"
            style={{ background: "#12152a", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {status === "done" ? (
              <div className="space-y-4">
                <p className="klr-eyebrow">Report lyrics</p>
                <h2
                  id="report-lyrics-title"
                  className="text-xl font-bold tracking-[-0.01em]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Thanks for flagging this
                </h2>
                <p className="text-sm text-[color:var(--color-text-muted)]">
                  Your report was recorded. When enough listeners flag the same lyrics, this
                  revision stops being promoted and drops in the rankings for review.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-1">
                  <p className="klr-eyebrow">Report lyrics</p>
                  <h2
                    id="report-lyrics-title"
                    className="text-xl font-bold tracking-[-0.01em]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    What&rsquo;s wrong with these lyrics?
                  </h2>
                  <p className="text-sm text-[color:var(--color-text-muted)]">
                    For wrong or missing words &mdash; not timing. Lyrics that appear early or
                    late go through &ldquo;Report timing offset&rdquo; instead.
                  </p>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-sm text-[color:var(--color-text-muted)]">Reason</span>
                  <select
                    ref={selectRef}
                    className="field"
                    value={reason}
                    onChange={(e) => setReason(e.target.value as ReportReason)}
                    required
                  >
                    <option value="" disabled>
                      Select a reason&hellip;
                    </option>
                    {REPORT_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm text-[color:var(--color-text-muted)]">
                    Note{" "}
                    <span className="text-[color:var(--color-text-dim)]">(optional)</span>
                  </span>
                  <textarea
                    className="field"
                    rows={3}
                    maxLength={MAX_REPORT_NOTE_LENGTH}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. the second verse repeats the chorus by mistake"
                    style={{ resize: "vertical" }}
                  />
                  <span className="block text-right text-xs text-[color:var(--color-text-dim)]">
                    {note.length}/{MAX_REPORT_NOTE_LENGTH}
                  </span>
                </label>

                {error && (
                  <p className="text-sm" style={{ color: "var(--klr-hi)" }}>
                    {error}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={!reason || status === "sending"}
                  >
                    {status === "sending" ? "Sending…" : "Submit report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
