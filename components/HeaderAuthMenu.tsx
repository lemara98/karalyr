"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";

export type HeaderUser = { email: string; isAdmin?: boolean } | null;

/**
 * Header login-status element. The auth state itself is resolved server-side
 * in HeaderAuth.tsx and passed down as a plain prop.
 */
export function HeaderAuthMenu({ user }: { user: HeaderUser }) {
  const pathname = usePathname();

  if (!user) {
    // Send the visitor back where they were after signing in — but never
    // emit a self-referential next=/login.
    const href =
      pathname === "/login" ? "/login" : `/login?next=${encodeURIComponent(pathname)}`;
    return (
      <Link
        href={href}
        className="text-sm text-[color:var(--color-text-muted)] transition-colors hover:text-[color:var(--color-text)]"
      >
        Sign in
      </Link>
    );
  }

  return <UserMenu email={user.email} isAdmin={user.isAdmin ?? false} pathname={pathname} />;
}

/** Avatar chip + dropdown for the signed-in state. */
function UserMenu({
  email,
  isAdmin,
  pathname,
}: {
  email: string;
  isAdmin: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white shadow-[0_8px_24px_-12px_rgba(255,107,157,0.6)] transition-transform hover:scale-105"
        style={{ background: "linear-gradient(135deg, var(--klr-a), var(--klr-b))" }}
      >
        {(email[0] || "?").toUpperCase()}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-white/10 bg-[#131729] p-1.5 shadow-xl"
        >
          <p className="truncate px-3 py-2 text-xs text-[color:var(--color-text-dim)]">
            {email || "Signed in"}
          </p>
          <div className="my-1 border-t border-white/5" />
          {isAdmin && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-[color:var(--klr-hi)] transition-colors hover:bg-white/5 hover:text-[color:var(--color-text)]"
            >
              Admin panel
            </Link>
          )}
          <a
            href="https://karafilt.com/account"
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-[color:var(--color-text)]"
          >
            Manage account
          </a>
          <form action={logout} role="none">
            <input
              type="hidden"
              name="next"
              value={pathname === "/login" ? "/" : pathname}
            />
            <button
              type="submit"
              role="menuitem"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[color:var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-[color:var(--color-text)]"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
