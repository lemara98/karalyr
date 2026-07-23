// GitHub contributors for the landing page community section, ported from
// the karafilt.com website.
//
// Caching: the GET request is cached in Next's Data Cache via
// `next.revalidate`, so GitHub is hit at most once per revalidation window
// even though the landing page renders dynamically. An unauthenticated call
// is plenty at that rate; set GITHUB_TOKEN to raise the limit anyway.

const GITHUB_API = "https://api.github.com";
const OWNER = process.env.GITHUB_OWNER ?? "lemara98";
const REPO = process.env.GITHUB_REPO ?? "karalyr";
const REVALIDATE_SECONDS = 86_400; // once a day

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
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contributors?per_page=100`, {
      headers,
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
