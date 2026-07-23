import type { MetadataRoute } from "next";
import { isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tracks } from "@/lib/db/schema";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://karalyr.com";

// Re-generate hourly: with lyrics landing daily, new track pages should
// reach the sitemap without waiting for a redeploy.
export const revalidate = 3600;

// Public, indexable pages. Auth-gated routes (/admin, /login) and the
// api/auth handlers are intentionally excluded — see robots.ts.
const ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/library", changeFrequency: "daily", priority: 0.9 },
  { path: "/contribute", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs", changeFrequency: "monthly", priority: 0.7 },
  { path: "/queue", changeFrequency: "weekly", priority: 0.6 },
  { path: "/sponsors", changeFrequency: "monthly", priority: 0.5 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = ROUTES.map(
    ({ path, changeFrequency, priority }) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency,
      priority,
    })
  );

  // Every track with published lyrics — the pages people actually search
  // for. Tracks without a best revision are thin shells; skip them. If the
  // database is unreachable (e.g. a build without env), the static pages
  // still ship rather than failing the whole sitemap.
  let trackEntries: MetadataRoute.Sitemap = [];
  try {
    const rows = await getDb()
      .select({ id: tracks.id, createdAt: tracks.createdAt })
      .from(tracks)
      .where(isNotNull(tracks.bestRevisionId));
    trackEntries = rows.map((t) => ({
      url: `${SITE_URL}/track/${t.id}`,
      lastModified: new Date(t.createdAt),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    // sitemap stays static-only
  }

  return [...staticEntries, ...trackEntries];
}
