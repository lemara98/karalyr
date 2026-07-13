import type { Tier } from "@/lib/db/schema";

const STYLES: Record<Tier, string> = {
  imported: "border-white/15 bg-white/5 text-[color:var(--color-text-muted)]",
  auto_aligned: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  community:
    "border-[color:color-mix(in_srgb,var(--klr-a)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--klr-a)_12%,transparent)] text-[color:#cfa8ff]",
  verified:
    "border-[color:color-mix(in_srgb,var(--klr-b)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--klr-b)_12%,transparent)] text-[color:var(--klr-hi)]",
};

const LABELS: Record<Tier, string> = {
  imported: "imported",
  auto_aligned: "auto-aligned",
  community: "community",
  verified: "verified",
};

export function TierBadge({ tier }: { tier: Tier | null }) {
  const cls = tier ? STYLES[tier] : "border-white/10 bg-white/[0.03] text-[color:var(--color-text-dim)]";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {tier ? LABELS[tier] : "no lyrics"}
    </span>
  );
}
