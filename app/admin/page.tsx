import Link from "next/link";
import { redirect } from "next/navigation";
import { adminStatus } from "@/lib/admin";
import { AdminPanel } from "@/components/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { isAdmin, email } = await adminStatus();

  // Nobody signed in and no legacy token cookie — send them to the shared
  // Karafilt login and come back here.
  if (!isAdmin && !email) redirect("/login?next=/admin");

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <p className="klr-eyebrow">MODERATION</p>
      <h1
        className="mt-2 text-3xl font-bold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Review queue
      </h1>

      {isAdmin ? (
        <>
          <p className="mb-7 mt-2 text-sm text-[color:var(--color-text-muted)]">
            Revisions targeting verified tracks queue here for review.
          </p>
          <AdminPanel />
        </>
      ) : (
        <div className="mt-2 max-w-md space-y-3">
          <p className="text-sm text-[color:var(--color-text-muted)]">
            You&rsquo;re signed in as{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{email}</span>, which
            doesn&rsquo;t have moderator access. Ask an existing admin to add your
            account.
          </p>
          <Link href="/" className="btn btn-secondary btn-sm">
            Back to the library
          </Link>
        </div>
      )}
    </div>
  );
}
