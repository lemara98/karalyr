import { AdminPanel } from "@/components/AdminPanel";

export default function AdminPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Moderation</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Revisions targeting verified tracks queue here for review.
      </p>
      <AdminPanel />
    </div>
  );
}
