import type { Contributor } from "@/lib/github";

/**
 * The contributor cards from the karafilt.com landing page, pointed at the
 * Karalyr repo. Plain <img> on purpose: avatars come from GitHub's CDN and
 * next/image would need a remotePatterns entry for one 40px thumbnail.
 */
export function ContributorsGrid({
  contributors,
  limit,
}: {
  contributors: Contributor[];
  limit?: number;
}) {
  const list = limit ? contributors.slice(0, limit) : contributors;

  if (list.length === 0) {
    return (
      <div className="klr-card p-10 text-center text-sm text-[color:var(--color-text-dim)]">
        Contributor list loads from GitHub. Be the first, open a pull request.
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {list.map((c) => (
        <li key={c.login}>
          <a
            href={c.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.05]"
          >
            <img
              src={c.avatarUrl}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-full"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{c.login}</p>
              <p className="text-xs text-[color:var(--color-text-dim)]">
                {c.contributions.toLocaleString("en-US")}{" "}
                {c.contributions === 1 ? "commit" : "commits"}
              </p>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
