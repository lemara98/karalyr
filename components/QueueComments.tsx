"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MAX_COMMENT_BODY_CHARS } from "@/lib/comments";
import { requestAndSolveChallenge } from "@/lib/pow-client";
import { createClient } from "@/lib/supabase/client";

interface JobComment {
  id: number;
  job_id: number;
  body: string;
  author_name: string;
  created_at: number;
}

/** undefined = still probing, null = signed out. */
type AuthUser = { id: string } | null | undefined;

type ComposerPhase = "idle" | "solving" | "posting";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Discussion under a queue candidate: flat, oldest first. Same posture as
 * lyric comments — public to read, a shared karafilt.com account plus a
 * proof-of-work to write.
 */
export function QueueComments({ jobId }: { jobId: number }) {
  const [comments, setComments] = useState<JobComment[] | null>(null);
  const [user, setUser] = useState<AuthUser>(undefined);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<ComposerPhase>("idle");
  const [solveLabel, setSolveLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    const res = await fetch(`/api/sync-queue/comments?job_id=${jobId}`);
    if (res.ok) {
      const body = await res.json();
      setComments(body.comments ?? []);
    }
  }, [jobId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setUser(data.user ? { id: data.user.id } : null))
      .catch(() => setUser(null));
  }, []);

  async function submit() {
    if (draft.trim() === "" || phase !== "idle") return;
    setError(null);
    try {
      setPhase("solving");
      const challenge = await requestAndSolveChallenge((p) =>
        setSolveLabel(`Solving proof-of-work… ${Math.round(p.attempts / 1000)}k attempts`)
      );
      setPhase("posting");
      const res = await fetch("/api/sync-queue/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge, job_id: jobId, body: draft.trim() }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(resBody.message ?? "Something went wrong");
        return;
      }
      setDraft("");
      await fetchComments();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-lg font-semibold">Comments</h2>
        {comments && (
          <span
            className="text-xs text-[color:var(--color-text-dim)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {comments.length}
          </span>
        )}
      </div>

      {comments && comments.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2.5">
          {comments.map((c) => (
            <li key={c.id} className="klr-card p-3.5">
              <p className="mb-1 text-xs text-[color:var(--color-text-dim)]">
                <span className="font-medium text-[color:var(--color-text-muted)]">
                  {c.author_name}
                </span>{" "}
                · {fmtDate(c.created_at)}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm text-[color:var(--color-text)]">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
      {comments && comments.length === 0 && (
        <p className="mb-4 text-sm text-[color:var(--color-text-dim)]">
          No comments yet — say why this song matters.
        </p>
      )}

      {user === null && (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          <Link
            href={`/login?next=${encodeURIComponent(`/queue/${jobId}`)}`}
            className="btn btn-secondary btn-sm mr-2"
          >
            Sign in to comment
          </Link>
          Accounts are shared with karafilt.com.
        </p>
      )}
      {user && (
        <div className="space-y-2">
          <textarea
            className="field min-h-24"
            maxLength={MAX_COMMENT_BODY_CHARS}
            placeholder="Add a comment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={phase !== "idle"}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={submit}
              disabled={phase !== "idle" || draft.trim() === ""}
            >
              {phase === "solving" ? "Working…" : phase === "posting" ? "Posting…" : "Post comment"}
            </button>
            {phase === "solving" && (
              <span className="text-xs text-[color:var(--color-text-dim)]">{solveLabel}</span>
            )}
            {error && (
              <span className="text-xs" style={{ color: "var(--klr-hi)" }}>
                {error}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
