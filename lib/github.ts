// GitHub contributors for the landing page community section, ported from
// the karafilt.com website.
//
// Caching: the GET request is cached in Next's Data Cache via
// `next.revalidate`, so GitHub is hit at most once per revalidation window
// even though the landing page renders dynamically. An unauthenticated call
// is plenty at that rate; set GITHUB_TOKEN to raise the limit anyway.

import { unstable_cache } from "next/cache";

const GITHUB_API = "https://api.github.com";
const OWNER = process.env.GITHUB_OWNER ?? "lemara98";
const REPO = process.env.GITHUB_REPO ?? "karalyr";
const SPONSOR_LOGIN = process.env.GITHUB_SPONSORS_LOGIN ?? "lemara98";
const REVALIDATE_SECONDS = 86_400; // once a day

function baseHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Where "See all contributors" points — the repo's contributors graph. */
export const CONTRIBUTORS_URL = `https://github.com/${OWNER}/${REPO}/graphs/contributors`;

export type Contributor = {
  login: string;
  avatarUrl: string;
  profileUrl: string;
  contributions: number;
};

type RawContributor = {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
};

export async function getContributors(): Promise<Contributor[]> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contributors?per_page=100`, {
      headers: baseHeaders(process.env.GITHUB_TOKEN),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return (data as RawContributor[])
      .filter((c) => c.type !== "Bot" && !c.login.endsWith("[bot]"))
      .map((c) => ({
        login: c.login,
        avatarUrl: c.avatar_url,
        profileUrl: c.html_url,
        contributions: c.contributions,
      }))
      .sort((a, b) => b.contributions - a.contributions);
  } catch {
    return [];
  }
}

// ── Sponsors ──────────────────────────────────────────────────────────────
// Ported from the karafilt.com website: the GitHub Sponsors list for the
// maintainer, via the GraphQL API. Needs GITHUB_TOKEN; without one the page
// shows its "wires up once you enroll" state. GraphQL POSTs bypass Next's
// Data Cache, hence the unstable_cache wrapper.

export type Sponsor = {
  name: string;
  avatarUrl: string;
  profileUrl: string;
  /** USD. The tier's monthly price (or the one-time amount). */
  amount: number;
  isOneTime: boolean;
};

export type SponsorsResult = {
  /** false when no GITHUB_TOKEN is set — drives the "not wired up yet" state. */
  configured: boolean;
  public: Sponsor[];
  /** Sponsors who chose to stay private on GitHub — shown anonymously. */
  privateCount: number;
};

const SPONSORS_QUERY = `
query ($login: String!, $cursor: String) {
  user(login: $login) {
    sponsorshipsAsMaintainer(first: 100, after: $cursor, includePrivate: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        privacyLevel
        isOneTimePayment
        tier { monthlyPriceInDollars }
        sponsorEntity {
          __typename
          ... on User { login name avatarUrl url }
          ... on Organization { login name avatarUrl url }
        }
      }
    }
  }
}`;

type SponsorEntity = {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
} | null;

type SponsorshipNode = {
  privacyLevel: string;
  isOneTimePayment: boolean;
  tier: { monthlyPriceInDollars: number } | null;
  sponsorEntity: SponsorEntity;
};

type SponsorsResponse = {
  data?: {
    user?: {
      sponsorshipsAsMaintainer?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: SponsorshipNode[];
      };
    };
  };
};

async function fetchSponsors(): Promise<SponsorsResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { configured: false, public: [], privateCount: 0 };

  try {
    const publicSponsors: Sponsor[] = [];
    let privateCount = 0;
    let cursor: string | null = null;

    // Paginate, with a hard safety cap.
    for (let page = 0; page < 20; page++) {
      const res = await fetch(`${GITHUB_API}/graphql`, {
        method: "POST",
        headers: { ...baseHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          query: SPONSORS_QUERY,
          variables: { login: SPONSOR_LOGIN, cursor },
        }),
        cache: "no-store", // caching is handled by unstable_cache below
      });
      if (!res.ok) break;

      const json = (await res.json()) as SponsorsResponse;
      const conn = json.data?.user?.sponsorshipsAsMaintainer;
      if (!conn) break;

      for (const node of conn.nodes ?? []) {
        const entity = node.sponsorEntity;
        if (node.privacyLevel !== "PUBLIC" || !entity) {
          privateCount++;
          continue;
        }
        publicSponsors.push({
          name: entity.name || entity.login,
          avatarUrl: entity.avatarUrl,
          profileUrl: entity.url,
          amount: node.tier?.monthlyPriceInDollars ?? 0,
          isOneTime: node.isOneTimePayment,
        });
      }

      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }

    publicSponsors.sort((a, b) => b.amount - a.amount);
    return { configured: true, public: publicSponsors, privateCount };
  } catch {
    return { configured: false, public: [], privateCount: 0 };
  }
}

export const getSponsors = unstable_cache(fetchSponsors, ["github-sponsors"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["github-sponsors"],
});
