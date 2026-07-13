import { AdminPanel } from "@/components/AdminPanel";

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <p className="klr-eyebrow">MODERATION</p>
      <h1
        className="mt-2 text-3xl font-bold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Review queue
      </h1>
      <p className="mb-7 mt-2 text-sm text-[color:var(--color-text-muted)]">
        Revisions targeting verified tracks queue here for review.
      </p>
      <AdminPanel />
    </div>
  );
}
