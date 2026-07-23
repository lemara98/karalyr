"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "I want this" for a queue candidate. Signed-out clicks bounce through
 * /login and back to `nextPath`; success refreshes the server-rendered
 * counts around the button.
 */
export function QueueVoteButton({ jobId, nextPath }: { jobId: number; nextPath: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function vote() {
    setState("sending");
    setError(null);
    const res = await fetch("/api/sync-queue/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
    });
    if (res.status === 401) {
      router.push(`/login?next=${encodeURIComponent(nextPath)}`);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? "Could not record that");
      setState("idle");
      return;
    }
    setState("done");
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={vote}
        disabled={state !== "idle"}
      >
        {state === "done" ? "Counted" : state === "sending" ? "…" : "I want this"}
      </button>
      {error && (
        <span className="text-xs" style={{ color: "var(--klr-hi)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
