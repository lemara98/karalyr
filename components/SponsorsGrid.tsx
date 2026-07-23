import type { SponsorsResult } from "@/lib/github";

/**
 * The sponsor cards from the karafilt.com sponsors page, in Karalyr's card
 * idiom. Plain <img> like ContributorsGrid: avatars come from GitHub's CDN
 * and next/image would need a remotePatterns entry for a 44px thumbnail.
 */
function formatAmount(amount: number, isOneTime: boolean): string {
  return isOneTime ? `$${amount} one-time` : `$${amount}/mo`;
}

export function SponsorsGrid({ sponsors, limit }: { sponsors: SponsorsResult; limit?: number }) {
  const { configured, privateCount } = sponsors;
  const list = limit ? sponsors.public.slice(0, limit) : sponsors.public;
  const showPrivate = !limit && privateCount > 0;

  if (list.length === 0 && !showPrivate) {
    return (
      <div className="klr-card p-10 text-center text-sm text-[color:var(--color-text-dim)]">
        {configured
          ? "The first supporter could be you."
          : "GitHub Sponsors list, wires up once you enroll."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {list.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => (
            <li key={s.profileUrl}>
              <a
                href={s.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.05]"
              >
                <img
                  src={s.avatarUrl}
                  alt=""
                  width={44}
                  height={44}
                  loading="lazy"
                  className="h-11 w-11 shrink-0 rounded-full"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <span
                    className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ background: "linear-gradient(135deg, var(--klr-a), var(--klr-b))" }}
                  >
                    {formatAmount(s.amount, s.isOneTime)}
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
      {showPrivate && (
        <p className="text-sm text-[color:var(--color-text-dim)]">
          …and {privateCount} {privateCount === 1 ? "anonymous supporter" : "anonymous supporters"}{" "}
          who chose to stay private. Thank you too.
        </p>
      )}
    </div>
  );
}
