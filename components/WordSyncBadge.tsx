import { KaralyrMark } from "./KaralyrMark";

/**
 * The distinctive marker for word-timed lyrics: the Karalyr K (lyric-line
 * rows sweeping like a playhead) + label. Shown wherever a track's served
 * revision carries per-word timing, so word-synced entries stand out from
 * line-level ones at a glance.
 */
export function WordSyncBadge() {
  return (
    <span
      className="word-sync-badge inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        fontFamily: "var(--font-mono)",
        color: "var(--klr-hi)",
        borderColor: "color-mix(in srgb, var(--klr-b) 45%, transparent)",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--klr-a) 15%, transparent), color-mix(in srgb, var(--klr-b) 15%, transparent))",
      }}
      title="Word-level karaoke timing"
    >
      <span className="h-3 w-[11px] flex-none">
        <KaralyrMark />
      </span>
      word-synced
    </span>
  );
}
