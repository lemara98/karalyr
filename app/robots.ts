import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://karalyr.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Moderation and sign-in redirect unauthenticated crawlers around, and
      // API/auth handlers aren't pages — keep them out of the crawl entirely.
      disallow: ["/admin", "/login", "/api/", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
