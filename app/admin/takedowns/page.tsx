import Link from "next/link";
import { redirect } from "next/navigation";
import { adminStatus } from "@/lib/admin";
import { TakedownAdmin } from "@/components/TakedownAdmin";

export const dynamic = "force-dynamic";

export default async function TakedownsPage() {
  const { isAdmin, email } = await adminStatus();
  if (!isAdmin && !email) redirect("/login?next=/admin/takedowns");

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <p className="klr-eyebrow">MODERATION</p>
      <h1
        className="mt-2 text-3xl font-bold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Rights notices
      </h1>

      {isAdmin ? (
        <>
          <p className="mb-7 mt-2 text-sm text-[color:var(--color-text-muted)]">
            Complaints from{" "}
            <Link href="/takedown" className="text-[color:var(--klr-b)] hover:underline">
              /takedown
            </Link>
            . Removing purges the lyric payload — the revision row stays as a record,
            with no content in it. There is no undo.
          </p>
          <TakedownAdmin />
        </>
      ) : (
        <div className="mt-2 max-w-md space-y-3">
          <p className="text-sm text-[color:var(--color-text-muted)]">
            You&rsquo;re signed in as{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{email}</span>, which
            doesn&rsquo;t have moderator access.
          </p>
          <Link href="/" className="btn btn-secondary btn-sm">
            Back to the library
          </Link>
        </div>
      )}
    </div>
  );
}
