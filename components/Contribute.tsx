"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlignLocal } from "./AlignLocal";
import { TapEditor } from "./TapEditor";
import { detectFormat, parseByFormat, type ImportFormat } from "@/lib/formats";
import type { LyricsPayload } from "@/lib/formats/types";
import { solvePow } from "@/lib/pow-client";

type Mode = "paste" | "tap" | "ai";

interface PublishState {
  phase: "idle" | "solving" | "publishing" | "done" | "error";
  detail?: string;
  trackId?: number;
}

export function Contribute({ aiAlignEnabled = false }: { aiAlignEnabled?: boolean }) {
  const [mode, setMode] = useState<Mode>("paste");
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [album, setAlbum] = useState("");
  const [duration, setDuration] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const [raw, setRaw] = useState("");
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
      <div className={mode === "ai" ? "hidden" : "grid grid-cols-2 gap-3 sm:grid-cols-4"}>
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
        </div>
        <div className="klr-card p-5">
          {mode === "ai" ? (
            <AlignLocal />
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

      <div className={mode === "ai" ? "hidden" : "space-y-2.5"}>
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
