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
  return (
    <div className="flex gap-2">
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => download(`${baseName}.lrc`, serializeLrc(payload))}
      >
        Export LRC
      </button>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => download(`${baseName}.elrc`, serializeEnhancedLrc(payload))}
        disabled={!payload.meta.has_word_timing}
        title={payload.meta.has_word_timing ? undefined : "No word timing in this revision"}
      >
        Export Enhanced LRC
      </button>
    </div>
  );
}
