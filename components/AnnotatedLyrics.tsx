"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LyricsPayload } from "@/lib/formats/types";
import { anchorComments, type CommentAnchor } from "@/lib/comment-anchors";
import {
  INSTRUMENTAL_MARK,
  MAX_COMMENT_BODY_CHARS,
  MAX_COMMENT_RANGE_LINES,
} from "@/lib/comments";
import { requestAndSolveChallenge } from "@/lib/pow-client";
import { createClient } from "@/lib/supabase/client";
import { SINGER_STYLES } from "./LyricsPlayer";

interface CommentDto extends CommentAnchor {
  body: string;
  author_name: string;
  created_at: number;
}

/** undefined = probing, null = signed out */
type AuthUser = { id: string; email?: string } | null | undefined;

type ComposerPhase = "idle" | "solving" | "posting";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Genius-style annotated lyrics: the full text of the song where whole-line
 * ranges can be selected (click, shift-click to extend) and commented on.
 * Comments anchor to the revision they were written against and re-anchor
 * onto the current one by quote matching (see lib/comment-anchors.ts).
 */
export function AnnotatedLyrics({
  trackId,
  revisionId,
  payload,
}: {
  trackId: number;
  revisionId: number;
  payload: LyricsPayload;
}) {
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [sel, setSel] = useState<{ anchor: number; focus: number } | null>(null);
  const [user, setUser] = useState<AuthUser>(undefined);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<ComposerPhase>("idle");
  const [solveLabel, setSolveLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    const res = await fetch(`/api/track/${trackId}/comments`);
    if (res.ok) {
      const body = await res.json();
      setComments(body.comments);
    }
  }, [trackId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setUser(data.user ? { id: data.user.id, email: data.user.email } : null))
      .catch(() => setUser(null));
  }, []);

  const lineTexts = useMemo(() => payload.lines.map((l) => l.text), [payload]);

  const { anchored, orphaned } = useMemo(
    () => anchorComments(lineTexts, revisionId, comments ?? []),
    [lineTexts, revisionId, comments]
  );

  const countByLine = useMemo(() => {
    const counts = new Array<number>(lineTexts.length).fill(0);
    for (const a of anchored) {
      for (let i = a.start; i <= a.end && i < counts.length; i++) counts[i]++;
    }
    return counts;
  }, [anchored, lineTexts.length]);

  const range = sel
    ? { start: Math.min(sel.anchor, sel.focus), end: Math.max(sel.anchor, sel.focus) }
    : null;
  const rangeTooLong = range !== null && range.end - range.start + 1 > MAX_COMMENT_RANGE_LINES;

  const fragmentComments = range
    ? anchored
        .filter((a) => a.start <= range.end && a.end >= range.start)
        .map((a) => a.comment)
        .sort((a, b) => a.created_at - b.created_at)
    : [];

  function onLineClick(i: number, e: React.MouseEvent) {
    setError(null);
    if (e.shiftKey && sel) {
      setSel({ anchor: sel.anchor, focus: i });
    } else if (sel && sel.anchor === i && sel.focus === i) {
      setSel(null);
    } else {
      setSel({ anchor: i, focus: i });
    }
  }

  async function submit() {
    if (!range || rangeTooLong || !draft.trim() || phase !== "idle") return;
    setError(null);
    setPhase("solving");
    setSolveLabel("Solving proof-of-work…");
    try {
      const challenge = await requestAndSolveChallenge((p) =>
        setSolveLabel(`Solving proof-of-work… ${Math.round(p.attempts / 1000)}k attempts`)
      );
      setPhase("posting");
      const res = await fetch(`/api/track/${trackId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge,
          start_line: range.start,
          end_line: range.end,
          body: draft.trim(),
        }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(resBody.message ?? "Something went wrong");
        return;
      }
      setDraft("");
      await fetchComments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <h2
          className="text-xl font-bold tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Lyrics &amp; comments
        </h2>
        <span
          className="text-xs text-[color:var(--color-text-dim)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {comments === null ? "loading…" : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
        {/* Reading view — plain text, line-selectable */}
        <div className="klr-card select-none p-5">
          {payload.lines.map((line, i) => {
            const count = countByLine[i];
            const selected = range !== null && i >= range.start && i <= range.end;
            const text = line.text.trim();
            return (
              <p
                key={i}
                onClick={(e) => onLineClick(i, e)}
                className={`cursor-pointer rounded-md px-3 py-1 text-[15px] leading-relaxed transition-colors ${
                  selected
                    ? "bg-[color:color-mix(in_srgb,var(--klr-b)_22%,transparent)] ring-1 ring-[color:color-mix(in_srgb,var(--klr-b)_55%,transparent)]"
                    : count > 0
                      ? "bg-[color:color-mix(in_srgb,var(--klr-a)_14%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--klr-a)_22%,transparent)]"
                      : "hover:bg-white/5"
                }`}
              >
                {line.singer && (
                  <span
                    className={`mr-2 inline-block rounded-full border px-2 py-px align-middle text-[10px] tracking-wide ${SINGER_STYLES[line.singer]}`}
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {line.singer}
                  </span>
                )}
                {text || <span className="opacity-50">{INSTRUMENTAL_MARK}</span>}
                {count > 0 && (
                  <span
                    className="ml-2 inline-block rounded-full border border-white/15 px-1.5 align-middle text-[10px] text-[color:var(--color-text-muted)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    💬 {count}
                  </span>
                )}
              </p>
            );
          })}
        </div>

        {/* Comment rail */}
        <aside className="space-y-3 lg:sticky lg:top-6">
          {range === null ? (
            <div className="klr-card p-4 text-sm text-[color:var(--color-text-muted)]">
              Click a line to read or add comments. Shift-click selects a range.
              {anchored.length > 0 && (
                <p className="mt-2 text-xs text-[color:var(--color-text-dim)]">
                  Highlighted lines already have comments.
                </p>
              )}
            </div>
          ) : (
            <div className="klr-card space-y-4 p-4">
              <blockquote
                className="whitespace-pre-wrap border-l-2 border-[color:color-mix(in_srgb,var(--klr-b)_55%,transparent)] pl-3 text-xs text-[color:var(--color-text-dim)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {lineTexts
                  .slice(range.start, range.end + 1)
                  .map((t) => t.trim() || INSTRUMENTAL_MARK)
                  .join("\n")}
              </blockquote>

              {fragmentComments.length === 0 ? (
                <p className="text-sm text-[color:var(--color-text-muted)]">
                  No comments on these lines yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {fragmentComments.map((c) => (
                    <li key={c.id} className="border-b border-white/5 pb-3 last:border-b-0 last:pb-0">
                      <p className="text-xs text-[color:var(--color-text-dim)]">
                        <span className="font-medium text-[color:var(--color-text-muted)]">
                          {c.author_name}
                        </span>{" "}
                        · {fmtDate(c.created_at)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              {rangeTooLong ? (
                <p className="text-xs text-[color:var(--color-text-dim)]">
                  Select at most {MAX_COMMENT_RANGE_LINES} lines to comment.
                </p>
              ) : user === null ? (
                <div className="space-y-2">
                  <Link
                    href={`/login?next=${encodeURIComponent(`/track/${trackId}`)}`}
                    className="btn btn-secondary btn-sm"
                  >
                    Sign in to comment
                  </Link>
                  <p className="text-xs text-[color:var(--color-text-dim)]">
                    Accounts are shared with karafilt.com.
                  </p>
                </div>
              ) : user ? (
                <div className="space-y-2">
                  <textarea
                    className="field w-full"
                    rows={3}
                    maxLength={MAX_COMMENT_BODY_CHARS}
                    placeholder="Add a comment on these lines…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={phase !== "idle"}
                  />
                  <div className="flex items-center gap-3">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={submit}
                      disabled={phase !== "idle" || !draft.trim()}
                    >
                      {phase === "posting" ? "Posting…" : "Post comment"}
                    </button>
                    {phase === "solving" && (
                      <span
                        className="text-xs text-[color:var(--color-text-dim)]"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {solveLabel}
                      </span>
                    )}
                  </div>
                  {error && <p className="text-xs text-red-300">{error}</p>}
                  <p className="text-xs text-[color:var(--color-text-dim)]">
                    Commenting as {user.email ?? "your Karafilt account"}.
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {orphaned.length > 0 && (
            <div className="klr-card space-y-3 p-4">
              <p className="klr-eyebrow !text-[11px]">ON EARLIER LYRICS</p>
              {orphaned.map((c) => (
                <div key={c.id} className="border-b border-white/5 pb-3 last:border-b-0 last:pb-0">
                  <blockquote
                    className="whitespace-pre-wrap text-xs text-[color:var(--color-text-dim)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {c.quote}
                  </blockquote>
                  <p className="mt-1 text-xs text-[color:var(--color-text-dim)]">
                    <span className="font-medium text-[color:var(--color-text-muted)]">
                      {c.author_name}
                    </span>{" "}
                    · {fmtDate(c.created_at)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
