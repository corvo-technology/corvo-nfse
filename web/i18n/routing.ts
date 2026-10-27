import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "pt"],
  defaultLocale: "pt",
  // The root (/) picks the language from Accept-Language, falling back to pt.
  localeDetection: true,
  // hreflang lives in the HTML and the sitemap (lib/seo.ts); a Link header would duplicate it.
  alternateLinks: false,
});
