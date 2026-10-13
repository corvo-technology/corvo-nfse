import type { MetadataRoute } from "next";

const siteUrl = "https://corvo.tech";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/app/",
        "/login",
        "/docs",
        "/brand",
        "/dpa",
        "/privacy",
        "/security",
        "/status",
        "/terms",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
