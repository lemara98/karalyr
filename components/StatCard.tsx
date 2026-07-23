/** The stat tile used on the landing page and /library. */
export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="klr-card p-5">
      <p className="klr-eyebrow !text-[11px]">{label}</p>
      <p
        className="mt-2 text-3xl font-bold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[13px] text-[color:var(--color-text-muted)]">{hint}</p>
    </div>
  );
}
