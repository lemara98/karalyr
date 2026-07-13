import { useId } from "react";

/**
 * The Karalyr mark: Karafilt's 72x80 K grid rebuilt from horizontal lyric
 * lines that light up top-to-bottom like a karaoke playhead. Rows share the
 * grid and rounded units of Karafilt's EQ-bar K.
 */

// x, y, w, h per rect; rows animate with a staggered sweep.
const ROWS: [number, number, number, number, number][] = [
  [6, 6, 12, 8, 0],
  [50, 6, 16, 8, 0],
  [6, 17, 12, 8, 0.16],
  [40, 17, 16, 8, 0.16],
  [6, 28, 12, 8, 0.32],
  [30, 28, 16, 8, 0.32],
  [6, 39, 30, 8, 0.48],
  [6, 50, 12, 8, 0.64],
  [30, 50, 16, 8, 0.64],
  [6, 61, 12, 8, 0.8],
  [40, 61, 16, 8, 0.8],
  [6, 72, 12, 8, 0.96],
  [50, 72, 16, 8, 0.96],
];

export function KaralyrMark({
  gradA = "#b46cff",
  gradB = "#ff6b9d",
  animated = true,
  className,
}: {
  gradA?: string;
  gradB?: string;
  animated?: boolean;
  className?: string;
}) {
  const gid = useId();
  return (
    <svg
      viewBox="0 0 72 80"
      role="img"
      aria-label="Karalyr"
      className={className}
      style={{ height: "100%", width: "100%", display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={gradA} />
          <stop offset="100%" stopColor={gradB} />
        </linearGradient>
      </defs>
      <g fill={`url(#${gid})`}>
        {ROWS.map(([x, y, w, h, delay], i) => (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={2}
            className={animated ? "klr-k-row" : undefined}
            style={animated ? { animationDelay: `${delay}s` } : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
