"use client";

import { serializeEnhancedLrc } from "@/lib/formats/enhanced-lrc";
import { serializeLrc } from "@/lib/formats/lrc";
import type { LyricsPayload } from "@/lib/formats/types";

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButtons({
  payload,
  baseName,
}: {
  payload: LyricsPayload;
  baseName: string;
}) {
  const btn =
    "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";
  return (
    <div className="flex gap-2">
      <button className={btn} onClick={() => download(`${baseName}.lrc`, serializeLrc(payload))}>
        Export LRC
      </button>
      <button
        className={btn}
        onClick={() => download(`${baseName}.elrc`, serializeEnhancedLrc(payload))}
        disabled={!payload.meta.has_word_timing}
        title={payload.meta.has_word_timing ? undefined : "No word timing in this revision"}
      >
        Export Enhanced LRC
      </button>
    </div>
  );
}
