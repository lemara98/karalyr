import type { Tier } from "@/lib/db/schema";

const STYLES: Record<Tier, string> = {
  imported: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  auto_aligned: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  community: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  verified: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

const LABELS: Record<Tier, string> = {
  imported: "imported",
  auto_aligned: "auto-aligned",
  community: "community",
  verified: "verified",
};

export function TierBadge({ tier }: { tier: Tier | null }) {
  if (!tier) {
    return (
      <span className="rounded px-1.5 py-0.5 text-xs bg-zinc-100 text-zinc-400 dark:bg-zinc-900">
        no lyrics
      </span>
    );
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STYLES[tier]}`}>
      {LABELS[tier]}
    </span>
  );
}
