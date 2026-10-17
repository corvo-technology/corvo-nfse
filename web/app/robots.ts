import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Marketing pages and the docs are meant to be found. Only the logged-in
 * dashboard, login, the agent consent screen and the proxy are kept out.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app/", "/login", "/mcp/", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
