import type { MetadataRoute } from "next";
import { DOC_SLUGS } from "@/lib/docs/registry";
import { BLOG_LOCALE, POSTS } from "@/lib/blog/registry";
import { BLOG_PATH, postPath } from "@/lib/blog/seo";
import { DEFAULT_SEO_LOCALE, SEO_LOCALES, type SeoLocale, pageUrl } from "@/lib/seo";

type Frequency = "weekly" | "monthly" | "yearly";
interface SitemapPage {
  path: string;
  changeFrequency: Frequency;
  priority: number;
  /** ISO date of the last real content change. Update it when the page changes. */
  lastModified: string;
  /** Languages the page exists in. Omitted means every language. */
  locales?: readonly SeoLocale[];
}

/** Last content change per group of pages. */
export const LAST_MODIFIED = {
  marketing: "2026-10-27",
  products: "2026-11-27",
  docs: "2026-10-27",
  legal: "2026-10-27",
} as const;

/** Paths (without locale) that exist in every language. */
export const PAGES: SitemapPage[] = [
  { path: "", changeFrequency: "weekly", priority: 1, lastModified: LAST_MODIFIED.marketing },
  { path: "/start", changeFrequency: "monthly", priority: 0.9, lastModified: LAST_MODIFIED.marketing },
  { path: "/integrations", changeFrequency: "monthly", priority: 0.8, lastModified: LAST_MODIFIED.products },
  { path: "/nf-e", changeFrequency: "monthly", priority: 0.7, lastModified: LAST_MODIFIED.products },
  { path: "/nfc-e", changeFrequency: "monthly", priority: 0.7, lastModified: LAST_MODIFIED.products },
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
 * The blog index and every post, in Portuguese only. `lastModified` is the date the content
 * really changed (`updatedAt`), and the index moves with its newest post.
 */
export function blogPages(): SitemapPage[] {
  const locales = [BLOG_LOCALE] as const;
  const newest = POSTS.reduce((max, post) => (post.updatedAt > max ? post.updatedAt : max), "1970-01-01");
  return [
    { path: BLOG_PATH, changeFrequency: "weekly", priority: 0.8, lastModified: newest, locales },
    ...POSTS.map((post) => ({
      path: postPath(post.slug),
      changeFrequency: "monthly" as const,
      priority: 0.7,
      lastModified: post.updatedAt,
      locales,
    })),
  ];
}

/** One entry per language the page exists in, each listing its translations (hreflang). */
export default function sitemap(): MetadataRoute.Sitemap {
  return [...PAGES, ...blogPages()].flatMap(({ path, changeFrequency, priority, lastModified, locales = SEO_LOCALES }) =>
    locales.map((locale) => ({
      url: pageUrl(locale, path),
      lastModified,
      changeFrequency,
      priority,
      alternates: {
        languages: {
          ...Object.fromEntries(locales.map((value) => [value, pageUrl(value, path)])),
          "x-default": pageUrl(locales.length === 1 ? locales[0] : DEFAULT_SEO_LOCALE, path),
        },
      },
    })),
  );
}
