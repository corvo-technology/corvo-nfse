import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/** Kept out of every crawler: logged-in dashboard, login, agent consent screen and the API proxy. */
export const PRIVATE_PATHS = ["/app/", "/login", "/mcp/", "/api/"];

/**
 * AI crawlers, allowed for both training and search (decision of 27/10/2026).
 * Listed explicitly so the policy is visible and survives changes to the * rule.
 */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
];

/** Marketing pages and the docs are meant to be found; only private screens are blocked. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE_PATHS })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
