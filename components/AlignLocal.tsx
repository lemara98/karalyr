"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface JobState {
  status: "running" | "done" | "failed";
  log: string[];
  result: { trackId: number; revisionId: number } | null;
  error: string | null;
}

/** Human-readable phase from the worker's log lines. */
function phaseOf(log: string[]): string {
  const joined = log.join("\n");
  if (joined.includes("imported as revision")) return "Imported";
  if (joined.includes("forced alignment")) return "Aligning words to vocals…";
  if (joined.includes("demucs: separating")) return "Separating vocals (slowest step)…";
  if (joined.includes("downloading audio")) return "Downloading audio…";
  return "Starting worker…";
}

export function AlignLocal() {
  const [url, setUrl] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [artist, setArtist] = useState("");
  const [track, setTrack] = useState("");
  const [duration, setDuration] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  const lineCount = lyrics.split("\n").filter((l) => l.trim()).length;
  const busy = job?.status === "running";

  async function start() {
    setSubmitError(null);
    setJob(null);
    const body: Record<string, unknown> = { youtube_url: url.trim(), lyrics };
    if (artist.trim()) body.artist = artist.trim();
    if (track.trim()) body.track = track.trim();
    const d = parseFloat(duration);
    if (Number.isFinite(d) && d > 0) body.duration = d;

    const res = await fetch("/api/align-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSubmitError(resBody.message ?? `Failed to start (${res.status})`);
      return;
    }
    setJobId(resBody.job_id);
    setJob({ status: "running", log: [], result: null, error: null });
  }

  useEffect(() => {
    if (!jobId || job?.status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/align-local/${jobId}`);
        if (!res.ok) return;
        const next: JobState = await res.json();
        setJob(next);
      } catch {}
    }, 1500);
    return () => clearInterval(timer);
  }, [jobId, job?.status]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log]);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[color:var(--color-text-muted)]">
        True AI word alignment, run on <em>this</em> machine: vocals are
        isolated (Demucs), then your lyrics are force-aligned to them word by
        word. Takes ~5–10 minutes per song on CPU.
      </p>
      <p className="text-xs leading-relaxed text-[color:var(--klr-hi)]">
        Personal use only: downloading from YouTube violates YouTube&apos;s
        Terms of Service. The audio is processed in a temp folder and deleted
        when the run finishes — only timing data is kept.
      </p>

      <label className="block text-sm text-[color:var(--color-text-muted)]">
        YouTube URL *
        <input
          className="field mt-1.5"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          disabled={busy}
        />
      </label>

      <label className="block text-sm text-[color:var(--color-text-muted)]">
        Plain lyrics * — one sung line per row, include repeated choruses
        {lineCount > 0 && (
          <span className="ml-2 text-xs text-[color:var(--color-text-dim)]">
            {lineCount} lines
          </span>
        )}
        <textarea
          className="field mt-1.5 !rounded-xl text-sm"
          style={{ fontFamily: "var(--font-mono)" }}
          rows={10}
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder={"First sung line\nSecond sung line\n…"}
          disabled={busy}
        />
      </label>

      <details className="text-sm text-[color:var(--color-text-muted)]">
        <summary className="cursor-pointer text-[color:var(--color-text-dim)]">
          Artist / title / duration overrides (optional — auto-detected from the video)
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <input className="field" placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} disabled={busy} />
          <input className="field" placeholder="Title" value={track} onChange={(e) => setTrack(e.target.value)} disabled={busy} />
          <input className="field" placeholder="Duration (s)" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} disabled={busy} />
        </div>
      </details>

      <button
        onClick={start}
        disabled={busy || !url.trim() || lineCount < 2}
        className="btn btn-primary"
      >
        {busy ? "Aligning…" : "Align & publish"}
      </button>
      {submitError && <p className="text-sm text-red-400">{submitError}</p>}

      {job && (
        <div className="space-y-2.5">
          <p className="text-sm">
            {job.status === "running" && (
              <span className="text-[color:var(--klr-hi)]">⏳ {phaseOf(job.log)}</span>
            )}
            {job.status === "failed" && (
              <span className="text-red-400">Failed: {job.error}</span>
            )}
            {job.status === "done" && job.result && (
              <span className="text-[color:var(--klr-hi)]">
                ✅ Word-timed lyrics published!{" "}
                <Link
                  href={`/track/${job.result.trackId}`}
                  className="underline hover:text-[color:var(--color-text)]"
                >
                  Open the track →
                </Link>
              </span>
            )}
          </p>
          {job.log.length > 0 && (
            <pre
              ref={logRef}
              className="max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/25 p-3 text-[11px] leading-relaxed text-[color:var(--color-text-dim)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {job.log.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
