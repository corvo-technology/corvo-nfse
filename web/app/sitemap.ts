import type { MetadataRoute } from "next";
import { DOC_SLUGS } from "@/lib/docs/registry";
import { DEFAULT_SEO_LOCALE, SEO_LOCALES, pageUrl } from "@/lib/seo";

/** Paths (without locale) that exist in every language. */
const PAGES: { path: string; changeFrequency: "weekly" | "monthly" | "yearly"; priority: number }[] = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/start", changeFrequency: "monthly", priority: 0.9 },
  { path: "/docs", changeFrequency: "weekly", priority: 0.9 },
  ...DOC_SLUGS.map((slug) => ({ path: `/docs/${slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/dpa", changeFrequency: "yearly", priority: 0.2 },
];

/** One entry per language, each listing every translation (hreflang). */
export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap(({ path, changeFrequency, priority }) =>
    SEO_LOCALES.map((locale) => ({
      url: pageUrl(locale, path),
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
