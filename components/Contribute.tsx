"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlignLocal } from "./AlignLocal";
import { TapEditor } from "./TapEditor";
import { detectFormat, parseByFormat, type ImportFormat } from "@/lib/formats";
import type { LyricsPayload } from "@/lib/formats/types";
import { solvePow } from "@/lib/pow-client";

type Mode = "paste" | "tap" | "ai" | "request";

interface PublishState {
  phase: "idle" | "solving" | "publishing" | "done" | "error";
  detail?: string;
  trackId?: number;
}

interface SyncRequestJob {
  id: number;
  status: string;
  artist_name: string;
  track_name: string;
  video_url: string;
  created_at: number | string;
  last_error: string | null;
  rejection_reason: string | null;
  result_track_id: number | null;
}

/** Friendly copy for the documented /api/sync-queue/submit error codes. */
function syncSubmitError(status: number, body: { name?: string; message?: string }): string {
  switch (body.name) {
    case "AlreadySynced":
      return "This song already has word-synced lyrics.";
    case "AlreadyQueued":
      return "This song is already in the queue.";
    case "UnsupportedSource":
      return "Only YouTube links are supported.";
    case "BadLyrics":
      return "Need at least 4 lyric lines.";
    case "QueueFull":
      return "The queue is full right now — please try again later.";
  }
  if (status === 429) return "Daily limit reached — try again tomorrow.";
  if (status === 503) return "The queue is full right now — please try again later.";
  return body.message ?? `Request failed (${status})`;
}

function SyncStatusChip({ status }: { status: string }) {
  const color =
    status === "done"
      ? "text-[color:var(--klr-hi)]"
      : status === "failed"
        ? "text-red-400"
        : status === "rejected" || status === "cancelled"
          ? "text-red-300"
          : status === "processing"
            ? "text-[color:var(--klr-a)]"
            : "text-[color:var(--color-text-dim)]";
  return (
    <span
      className={`rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider ${color}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function RequestSync() {
  const [url, setUrl] = useState("");
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [album, setAlbum] = useState("");
  const [duration, setDuration] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [mine, setMine] = useState<SyncRequestJob[] | null>(null);
  const [state, setState] = useState<{ phase: "idle" | "submitting" | "done" | "error"; detail?: string }>({
    phase: "idle",
  });

  const lineCount = lyrics.split("\n").filter((l) => l.trim()).length;
  const busy = state.phase === "submitting";

  const loadMine = useCallback(async () => {
    const res = await fetch("/api/sync-queue/mine").catch(() => null);
    if (!res) return;
    if (res.status === 401) {
      setSignedIn(false);
      return;
    }
    // Non-401 errors: still show the form; submit will surface real problems.
    setSignedIn(true);
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    if (Array.isArray(body.jobs)) setMine(body.jobs);
  }, []);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  async function submit() {
    setState({ phase: "submitting" });
    const body: Record<string, unknown> = {
      video_url: url.trim(),
      artist_name: artist.trim(),
      track_name: title.trim(),
      lyrics,
    };
    if (album.trim()) body.album_name = album.trim();
    const d = parseFloat(duration);
    if (Number.isFinite(d) && d > 0) body.duration = d;

    const res = await fetch("/api/sync-queue/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res) {
      setState({ phase: "error", detail: "Network error — please try again." });
      return;
    }
    if (res.status === 401) {
      setSignedIn(false);
      return;
    }
    const resBody = await res.json().catch(() => ({}));
    if (res.status === 201) {
      setUrl("");
      setArtist("");
      setTitle("");
      setAlbum("");
      setDuration("");
      setLyrics("");
      setState({
        phase: "done",
        detail:
          "Submitted — an admin will approve it, then the aligner processes it (usually within a day).",
      });
      loadMine();
    } else {
      setState({ phase: "error", detail: syncSubmitError(res.status, resBody) });
    }
  }

  if (signedIn === null) {
    return <p className="text-sm text-[color:var(--color-text-dim)]">Loading…</p>;
  }

  if (signedIn === false) {
    return (
      <p className="text-sm text-[color:var(--color-text-muted)]">
        <Link
          href="/login?next=/contribute"
          className="text-[color:var(--klr-b)] hover:underline"
        >
          Sign in
        </Link>{" "}
        to request a sync.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[color:var(--color-text-muted)]">
        No local setup needed: submit a YouTube link and plain lyrics, and the
        aligner word-syncs the song on our end. An admin approves each request
        before it runs.
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-sm text-[color:var(--color-text-muted)]">
          Artist *
          <input
            className="field mt-1.5"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="text-sm text-[color:var(--color-text-muted)]">
          Title *
          <input
            className="field mt-1.5"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="text-sm text-[color:var(--color-text-muted)]">
          Album
          <input
            className="field mt-1.5"
            value={album}
            onChange={(e) => setAlbum(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="text-sm text-[color:var(--color-text-muted)]">
          Duration (s)
          <input
            className="field mt-1.5"
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <label className="block text-sm text-[color:var(--color-text-muted)]">
        Plain lyrics * — one sung line per row; LRC-timestamped text is fine,
        timings get stripped
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

      <button
        onClick={submit}
        disabled={busy || !url.trim() || !artist.trim() || !title.trim() || lineCount < 4}
        className="btn btn-primary"
      >
        {busy ? "Submitting…" : "Request AI sync"}
      </button>
      {state.phase !== "idle" && state.detail && (
        <p
          className={`text-sm ${
            state.phase === "error"
              ? "text-red-400"
              : state.phase === "done"
                ? "text-[color:var(--klr-hi)]"
                : "text-[color:var(--color-text-muted)]"
          }`}
        >
          {state.detail}
        </p>
      )}

      {mine && mine.length > 0 && (
        <div className="space-y-2 pt-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">
            Your requests
          </h3>
          {mine.map((j) => (
            <div
              key={j.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {j.artist_name} — {j.track_name}
              </span>
              <SyncStatusChip status={j.status} />
              {j.status === "done" && j.result_track_id && (
                <Link
                  href={`/track/${j.result_track_id}`}
                  className="text-[color:var(--klr-b)] hover:underline"
                >
                  View track →
                </Link>
              )}
              {j.status === "failed" && j.last_error && (
                <span className="text-xs text-red-400" title={j.last_error}>
                  {j.last_error.length > 60 ? `${j.last_error.slice(0, 60)}…` : j.last_error}
                </span>
              )}
              {j.status === "rejected" && j.rejection_reason && (
                <span className="text-xs text-red-300" title={j.rejection_reason}>
                  {j.rejection_reason.length > 60
                    ? `${j.rejection_reason.slice(0, 60)}…`
                    : j.rejection_reason}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Prefill for fixing an existing track: publishes a correction revision. */
export interface ContributeInitial {
  trackId: number;
  artist: string;
  title: string;
  album: string;
  duration: string;
  /** The track's current best lyrics as (Enhanced) LRC text. */
  raw: string;
  parentRevisionId: number;
}

export function Contribute({
  aiAlignEnabled = false,
  initial,
}: {
  aiAlignEnabled?: boolean;
  initial?: ContributeInitial;
}) {
  const [mode, setMode] = useState<Mode>("paste");
  const [artist, setArtist] = useState(initial?.artist ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [album, setAlbum] = useState(initial?.album ?? "");
  const [duration, setDuration] = useState(initial?.duration ?? "");
  const [videoUrl, setVideoUrl] = useState("");

  const [raw, setRaw] = useState(initial?.raw ?? "");
  const [format, setFormat] = useState<ImportFormat | "auto">("auto");
  const [tapPayload, setTapPayload] = useState<LyricsPayload | null>(null);
  const [state, setState] = useState<PublishState>({ phase: "idle" });

  const durationSeconds = parseFloat(duration) || 0;

  const preview = useMemo(() => {
    if (mode !== "paste" || raw.trim() === "") return null;
    const fmt = format === "auto" ? detectFormat(raw) : format;
    try {
      const payload = parseByFormat(raw, fmt);
      return {
        fmt,
        lines: payload.lines.length,
        wordTiming: payload.meta.has_word_timing,
        error: null as string | null,
      };
    } catch (err) {
      return { fmt, lines: 0, wordTiming: false, error: (err as Error).message };
    }
  }, [mode, raw, format]);

  const ready =
    artist.trim() !== "" &&
    title.trim() !== "" &&
    durationSeconds > 0 &&
    (mode === "paste" ? preview !== null && !preview.error : tapPayload !== null);

  async function publish() {
    try {
      setState({ phase: "solving", detail: "Requesting challenge…" });
      const chRes = await fetch("/api/request-challenge", { method: "POST" });
      if (!chRes.ok) throw new Error("Could not get a challenge");
      const challenge: { prefix: string; target: string } = await chRes.json();

      const nonce = await solvePow(challenge.prefix, challenge.target, (p) =>
        setState({
          phase: "solving",
          detail: `Solving proof-of-work… ${Math.round(p.attempts / 1000)}k attempts (${(p.elapsedMs / 1000).toFixed(1)}s)`,
        })
      );

      setState({ phase: "publishing", detail: "Publishing…" });
      const body: Record<string, unknown> = {
        challenge: { prefix: challenge.prefix, nonce },
        artist_name: artist.trim(),
        track_name: title.trim(),
        album_name: album.trim() || null,
        duration: durationSeconds,
        video_url: videoUrl.trim() || null,
      };
      if (mode === "paste") {
        body.raw = raw;
        body.format = format === "auto" ? detectFormat(raw) : format;
        if (body.format === "ultrastar") body.source = "ultrastar_import";
      } else {
        body.payload = tapPayload;
      }
      // Editing an existing track: chain to the revision being corrected so
      // the server records this as a correction, not a fresh submission.
      if (initial) body.parent_revision_id = initial.parentRevisionId;

      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.message ?? `Publish failed (${res.status})`);
      setState({
        phase: "done",
        detail: resBody.message,
        trackId: resBody.track_id,
      });
    } catch (err) {
      setState({ phase: "error", detail: (err as Error).message });
    }
  }

  const tab = (active: boolean) =>
    `btn btn-sm ${active ? "btn-secondary" : "btn-ghost"}`;

  return (
    <div className="space-y-7">
      <div
        className={
          mode === "ai" || mode === "request"
            ? "hidden"
            : "grid grid-cols-2 gap-3 sm:grid-cols-4"
        }
      >
        <label className="text-sm text-[color:var(--color-text-muted)]">
          Artist *
          <input className="field mt-1.5" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
        <label className="text-sm text-[color:var(--color-text-muted)]">
          Title *
          <input className="field mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="text-sm text-[color:var(--color-text-muted)]">
          Album
          <input className="field mt-1.5" value={album} onChange={(e) => setAlbum(e.target.value)} />
        </label>
        <label className="text-sm text-[color:var(--color-text-muted)]">
          Duration (s) *
          <input
            className="field mt-1.5"
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label className="col-span-2 text-sm text-[color:var(--color-text-muted)] sm:col-span-4">
          YouTube or Spotify URL
          <input
            className="field mt-1.5"
            placeholder="https://www.youtube.com/watch?v=… or https://open.spotify.com/track/… (lets players find these lyrics by source)"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
          />
        </label>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          <button className={tab(mode === "paste")} onClick={() => setMode("paste")}>
            Paste lyrics file
          </button>
          <button className={tab(mode === "tap")} onClick={() => setMode("tap")}>
            Tap timing editor
          </button>
          {aiAlignEnabled && (
            <button className={tab(mode === "ai")} onClick={() => setMode("ai")}>
              🎯 AI align (local)
            </button>
          )}
          <button className={tab(mode === "request")} onClick={() => setMode("request")}>
            Request AI sync
          </button>
        </div>
        <div className="klr-card p-5">
          {mode === "ai" ? (
            <AlignLocal />
          ) : mode === "request" ? (
            <RequestSync />
          ) : mode === "paste" ? (
            <div className="space-y-3">
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={12}
                placeholder={"[00:12.04]First line…\nor Enhanced LRC / UltraStar .txt"}
                className="field !rounded-xl text-sm"
                style={{ fontFamily: "var(--font-mono)" }}
              />
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="text-[color:var(--color-text-muted)]">
                  Format{" "}
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as ImportFormat | "auto")}
                    className="field !w-auto !py-1.5"
                  >
                    <option value="auto">auto-detect</option>
                    <option value="lrc">Plain LRC</option>
                    <option value="enhanced_lrc">Enhanced LRC</option>
                    <option value="ultrastar">UltraStar .txt</option>
                  </select>
                </label>
                {preview && (
                  <span
                    className={
                      preview.error
                        ? "text-red-400"
                        : "text-[color:var(--color-text-dim)]"
                    }
                  >
                    {preview.error
                      ? `Parse error: ${preview.error}`
                      : `Detected ${preview.fmt}: ${preview.lines} lines, ${preview.wordTiming ? "word-level" : "line-level"} timing`}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <TapEditor durationSeconds={durationSeconds} onPayloadReady={setTapPayload} />
          )}
        </div>
      </div>

      <div className={mode === "ai" || mode === "request" ? "hidden" : "space-y-2.5"}>
        <button
          onClick={publish}
          disabled={!ready || state.phase === "solving" || state.phase === "publishing"}
          className="btn btn-primary"
        >
          Publish to the library
        </button>
        {state.phase !== "idle" && (
          <p
            className={`text-sm ${
              state.phase === "error"
                ? "text-red-400"
                : state.phase === "done"
                  ? "text-[color:var(--klr-hi)]"
                  : "text-[color:var(--color-text-muted)]"
            }`}
          >
            {state.detail}
            {state.phase === "done" && state.trackId && (
              <>
                {" "}
                <Link href={`/track/${state.trackId}`} className="text-[color:var(--klr-b)] hover:text-[color:var(--klr-hi)]">
                  View track →
                </Link>
              </>
            )}
          </p>
        )}
        <p className="text-xs text-[color:var(--color-text-dim)]">
          Publishing runs a ~1–2 second proof-of-work in your browser to deter
          spam. Submissions are anonymous; only a salted hash of your
          IP/browser is stored.
        </p>
      </div>
    </div>
  );
}
