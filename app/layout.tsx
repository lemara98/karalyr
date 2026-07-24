import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { Geist_Mono, Space_Grotesk } from "next/font/google";
import { Logo } from "@/components/Logo";
import { KaralyrMark } from "@/components/KaralyrMark";
import { HeaderAuth } from "@/components/HeaderAuth";
import { type NavLink } from "@/components/MobileMenu";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--font-space-grotesk",
});
const geistMono = Geist_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Karalyr — every word, right on time",
  description:
    "The open karaoke lyrics database: word-level timed lyrics, community corrections, and a free LRCLIB-compatible API. A Karafilt sibling.",
};

const NAV_LINKS: NavLink[] = [
  { label: "Library", href: "/library" },
  { label: "Studio", href: "/contribute" },
  { label: "Queue", href: "/queue" },
  { label: "Docs", href: "/docs" },
  { label: "Sponsors", href: "/sponsors" },
  { label: "Contributors", href: "/contributors" },
];

const FOOTER_COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "PRODUCT",
    links: [
      { label: "Library", href: "/library" },
      { label: "Studio", href: "/contribute" },
      { label: "Queue", href: "/queue" },
      { label: "API Docs", href: "/docs" },
    ],
  },
  {
    title: "FAMILY",
    links: [
      { label: "Karafilt", href: "https://karafilt.com" },
      { label: "Extension", href: "https://karafilt.com/install" },
    ],
  },
  {
    title: "COMMUNITY",
    links: [
      { label: "GitHub", href: "https://github.com/lemara98/karalyr" },
      { label: "LRCLIB", href: "https://lrclib.net" },
      { label: "Contributors", href: "/contributors" },
      { label: "Sponsors", href: "/sponsors" },
    ],
  },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${geistMono.variable}`}>
      <body>
        <header className="border-b border-white/5">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
            <Logo />
            <nav className="hidden items-center gap-7 text-sm sm:flex">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-[color:var(--color-text-muted)] transition-colors hover:text-[color:var(--color-text)]"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-3 sm:gap-4">
              <Link href="/contribute" className="btn btn-primary btn-sm">
                Open Studio
              </Link>
              <HeaderAuth navLinks={NAV_LINKS} />
            </div>
          </div>
        </header>

        <main className="min-h-[70vh]">{children}</main>

        <footer className="border-t border-white/5">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2">
                <span className="h-[18px] w-4 flex-none">
                  <KaralyrMark gradA="#ff6b9d" gradB="#ff6b9d" animated={false} />
                </span>
                <span
                  className="text-base font-bold tracking-[-0.02em]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  karalyr<span className="text-[color:var(--klr-b)]">.</span>
                </span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-[color:var(--color-text-muted)]">
                The open karaoke lyrics database. Open source (MIT) and
                non-commercial.
              </p>
              <a
                href="https://betania.io"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center gap-2 text-xs text-[color:var(--color-text-muted)] transition-colors hover:text-[color:var(--color-text)]"
              >
                {/* The Betania triangle mark, inlined from the karafilt site. */}
                <svg viewBox="76 0 1000 868" fill="none" className="h-4 w-auto" aria-hidden="true">
                  <path d="M1066.17 859H85.8291L575.999 9.99902L1066.17 859Z" stroke="#30D5C8" strokeWidth="10" />
                  <path d="M960.515 798H191.485L576 132L960.515 798Z" stroke="#30D5C8" strokeWidth="7" />
                  <path d="M861.789 741H290.211L576 245.999L861.789 741Z" stroke="#30D5C8" strokeWidth="3" />
                  <path d="M435.704 495H716.296L576 738.001L435.704 495Z" stroke="#30D5C8" strokeWidth="3" />
                </svg>
                <span>
                  Operated by <span className="font-semibold">Betania.io</span>
                </span>
              </a>
            </div>
            {FOOTER_COLS.map((col) => (
              <div key={col.title} className="flex flex-col gap-2.5">
                <p className="klr-eyebrow mb-0.5 !text-[11px]">{col.title}</p>
                {col.links.map((l) => (
                  <Link
                    key={l.label}
                    href={l.href}
                    className="text-[13px] text-[color:var(--color-text-muted)] transition-colors hover:text-[color:var(--color-text)]"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-white/5 px-6 py-4">
            <p className="mx-auto max-w-6xl text-xs text-[color:var(--color-text-dim)]">
              © 2026 Karalyr. A Karafilt sibling — developed by the community, operated by{" "}
              <a
                href="https://betania.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--klr-b)] underline decoration-dotted underline-offset-2 hover:no-underline"
              >
                Betania.io
              </a>
              .
            </p>
          </div>
        </footer>
        {/* Page views + Web Vitals. No-ops outside Vercel, so dev is unaffected. */}
        <Analytics />
      </body>
    </html>
  );
}
