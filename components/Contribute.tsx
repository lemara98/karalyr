"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TapEditor } from "./TapEditor";
import { detectFormat, parseByFormat, type ImportFormat } from "@/lib/formats";
import type { LyricsPayload } from "@/lib/formats/types";
import { solvePow } from "@/lib/pow-client";

type Mode = "paste" | "tap";

interface PublishState {
  phase: "idle" | "solving" | "publishing" | "done" | "error";
  detail?: string;
  trackId?: number;
}

export function Contribute() {
  const [mode, setMode] = useState<Mode>("paste");
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [album, setAlbum] = useState("");
  const [duration, setDuration] = useState("");

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

  const input =
    "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  const tab = (active: boolean) =>
    `rounded-t px-4 py-2 text-sm font-medium ${
      active
        ? "border border-b-0 border-zinc-300 dark:border-zinc-700"
        : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
    }`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-1 text-sm">
          Artist *
          <input className={input} value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
        <label className="col-span-1 text-sm">
          Title *
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="col-span-1 text-sm">
          Album
          <input className={input} value={album} onChange={(e) => setAlbum(e.target.value)} />
        </label>
        <label className="col-span-1 text-sm">
          Duration (s) *
          <input
            className={input}
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
      </div>

      <div>
        <div className="flex gap-1">
          <button className={tab(mode === "paste")} onClick={() => setMode("paste")}>
            Paste lyrics file
          </button>
          <button className={tab(mode === "tap")} onClick={() => setMode("tap")}>
            Tap timing editor
          </button>
        </div>
        <div className="rounded-b rounded-tr border border-zinc-300 p-4 dark:border-zinc-700">
          {mode === "paste" ? (
            <div className="space-y-3">
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={12}
                placeholder={"[00:12.04]First line…\nor Enhanced LRC / UltraStar .txt"}
                className="w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <div className="flex items-center gap-3 text-sm">
                <label>
                  Format{" "}
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as ImportFormat | "auto")}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="auto">auto-detect</option>
                    <option value="lrc">Plain LRC</option>
                    <option value="enhanced_lrc">Enhanced LRC</option>
                    <option value="ultrastar">UltraStar .txt</option>
                  </select>
                </label>
                {preview && (
                  <span className={preview.error ? "text-red-600" : "text-zinc-500"}>
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

      <div className="space-y-2">
        <button
          onClick={publish}
          disabled={!ready || state.phase === "solving" || state.phase === "publishing"}
          className="rounded bg-zinc-900 px-5 py-2.5 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Publish
        </button>
        {state.phase !== "idle" && (
          <p
            className={`text-sm ${
              state.phase === "error"
                ? "text-red-600"
                : state.phase === "done"
                  ? "text-emerald-600"
                  : "text-zinc-500"
            }`}
          >
            {state.detail}
            {state.phase === "done" && state.trackId && (
              <>
                {" "}
                <Link href={`/track/${state.trackId}`} className="underline">
                  View track →
                </Link>
              </>
            )}
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Publishing runs a ~1–2 second proof-of-work in your browser to deter
          spam. Submissions are anonymous; only a salted hash of your
          IP/browser is stored.
        </p>
      </div>
    </div>
  );
}
