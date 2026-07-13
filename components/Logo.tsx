import Link from "next/link";
import { KaralyrMark } from "./KaralyrMark";

/** The "karalyr." lockup with the mark and the family pulsing dot. */
export function Logo({ size = 19 }: { size?: number }) {
  const markH = Math.round(size * 1.16);
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span style={{ height: markH, width: Math.round(markH * 0.9) }} className="flex-none">
        <KaralyrMark />
      </span>
      <span
        className="font-bold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)", fontSize: size }}
      >
        karalyr<span className="logo-dot">.</span>
      </span>
    </Link>
  );
}
