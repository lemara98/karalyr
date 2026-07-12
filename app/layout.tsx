import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karalyr",
  description:
    "Open karaoke lyrics database: word-level timed lyrics, community corrections, open API.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4">
          <header className="flex items-center justify-between border-b border-zinc-200 py-4 dark:border-zinc-800">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Karalyr
              <span className="ml-2 text-xs font-normal text-zinc-500">
                karaoke lyrics database
              </span>
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/contribute" className="hover:underline">
                Contribute
              </Link>
              <Link href="/docs" className="hover:underline">
                API Docs
              </Link>
              <Link href="/admin" className="text-zinc-500 hover:underline">
                Admin
              </Link>
            </nav>
          </header>
          <main className="flex-1 py-8">{children}</main>
          <footer className="border-t border-zinc-200 py-4 text-xs text-zinc-500 dark:border-zinc-800">
            Karalyr is open source (MIT) and non-commercial. Lyrics are
            community-contributed; imports credit{" "}
            <a href="https://lrclib.net" className="underline">
              LRCLIB
            </a>
            .
          </footer>
        </div>
      </body>
    </html>
  );
}
