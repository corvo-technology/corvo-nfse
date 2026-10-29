import type { MetadataRoute } from "next";
import { DOC_SLUGS } from "@/lib/docs/registry";
import { DEFAULT_SEO_LOCALE, SEO_LOCALES, pageUrl } from "@/lib/seo";

type Frequency = "weekly" | "monthly" | "yearly";
interface SitemapPage {
  path: string;
  changeFrequency: Frequency;
  priority: number;
  /** ISO date of the last real content change. Update it when the page changes. */
  lastModified: string;
}

/** Last content change per group of pages. */
export const LAST_MODIFIED = {
  marketing: "2026-10-27",
  docs: "2026-10-27",
  legal: "2026-10-27",
} as const;

/** Paths (without locale) that exist in every language. */
export const PAGES: SitemapPage[] = [
  { path: "", changeFrequency: "weekly", priority: 1, lastModified: LAST_MODIFIED.marketing },
  { path: "/start", changeFrequency: "monthly", priority: 0.9, lastModified: LAST_MODIFIED.marketing },
  { path: "/docs", changeFrequency: "weekly", priority: 0.9, lastModified: LAST_MODIFIED.docs },
  { path: "/api-docs", changeFrequency: "weekly", priority: 0.9, lastModified: LAST_MODIFIED.docs },
  ...DOC_SLUGS.map((slug) => ({
    path: `/docs/${slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.8,
    lastModified: LAST_MODIFIED.docs,
  })),
  { path: "/security", changeFrequency: "monthly", priority: 0.4, lastModified: LAST_MODIFIED.marketing },
  { path: "/status", changeFrequency: "monthly", priority: 0.3, lastModified: LAST_MODIFIED.marketing },
  { path: "/brand", changeFrequency: "yearly", priority: 0.2, lastModified: LAST_MODIFIED.marketing },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2, lastModified: LAST_MODIFIED.legal },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2, lastModified: LAST_MODIFIED.legal },
  { path: "/dpa", changeFrequency: "yearly", priority: 0.2, lastModified: LAST_MODIFIED.legal },
];

/**
 * Blog hook: return the published posts here once the blog exists, as
 * { path: "/blog/<slug>", lastModified: "<ISO date>" }. Empty on purpose, no content yet.
 */
export function blogPages(): SitemapPage[] {
  return [];
}

/** One entry per language, each listing every translation (hreflang). */
export default function sitemap(): MetadataRoute.Sitemap {
  return [...PAGES, ...blogPages()].flatMap(({ path, changeFrequency, priority, lastModified }) =>
    SEO_LOCALES.map((locale) => ({
      url: pageUrl(locale, path),
      lastModified,
      changeFrequency,
      priority,
      alternates: {
        languages: {
          ...Object.fromEntries(SEO_LOCALES.map((value) => [value, pageUrl(value, path)])),
          "x-default": pageUrl(DEFAULT_SEO_LOCALE, path),
        },
      },
    })),
  );
}
