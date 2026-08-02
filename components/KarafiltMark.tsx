import { useId } from "react";

/**
 * Karafilt's EQ-bar K, inlined from karafilt.com's logo.svg - the sibling
 * mark to KaralyrMark, used wherever we point people at the extension.
 */
export function KarafiltMark({ className }: { className?: string }) {
  const gid = useId();
  return (
    <svg
      viewBox="0 0 72 80"
      role="img"
      aria-label="Karafilt"
      className={className}
      style={{ height: "100%", width: "100%", display: "block" }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b7cff" />
          <stop offset="100%" stopColor="#b46cff" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gid})`}>
        <rect x="6" y="6" width="10" height="68" rx="2" />
        <rect x="22" y="32" width="10" height="16" rx="2" />
        <rect x="34" y="24" width="10" height="32" rx="2" />
        <rect x="46" y="14" width="10" height="22" rx="2" />
        <rect x="46" y="44" width="10" height="22" rx="2" />
        <rect x="58" y="6" width="10" height="20" rx="2" />
        <rect x="58" y="54" width="10" height="20" rx="2" />
      </g>
    </svg>
  );
}
