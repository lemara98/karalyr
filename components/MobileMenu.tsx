"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavLink = { label: string; href: string };

/**
 * Burger-button navigation for viewports below the `sm` breakpoint, where the
 * inline header nav is hidden. The link list comes from the server layout so
 * desktop and mobile stay in sync. Signed-out visitors also get a Sign in
 * entry here, since the header link is hidden on mobile to save space.
 */
export function MobileMenu({ links, signedIn }: { links: NavLink[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close the panel whenever navigation lands on a new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
    <div ref={rootRef} className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--color-text-muted)] transition-colors hover:text-[color:var(--color-text)]"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </>
          ) : (
            <>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </>
          )}
        </svg>
      </button>
      {open && (
        <nav
          role="menu"
          className="absolute right-0 top-full z-50 mt-3 w-48 rounded-xl border border-white/10 bg-[#131729] p-1.5 shadow-xl"
        >
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 hover:text-[color:var(--color-text)] ${
                  active
                    ? "text-[color:var(--color-text)]"
                    : "text-[color:var(--color-text-muted)]"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          {!signedIn && (
            <>
              <div className="my-1 border-t border-white/5" />
              <Link
                href={
                  pathname === "/login"
                    ? "/login"
                    : `/login?next=${encodeURIComponent(pathname)}`
                }
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-[color:var(--color-text)]"
              >
                Sign in
              </Link>
            </>
          )}
        </nav>
      )}
    </div>
  );
}
