import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));

import ApiDocsPage, { generateMetadata } from "@/app/[locale]/api-docs/page";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import nextConfig from "@/next.config";
import { apiReference } from "@/lib/api-reference";

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe("/api-docs", () => {
  it("lists every endpoint from the docs registry with its success status", async () => {
    const html = renderToStaticMarkup(await ApiDocsPage(params("pt")));
    const { sections } = apiReference("pt");
    expect(sections.length).toBeGreaterThan(3);
    for (const section of sections) for (const endpoint of section.endpoints) expect(html).toContain(endpoint.path.replace(/&/g, "&amp;"));
    expect(html).toContain("POST");
    expect(html).toContain('id="errors"');
  });

  it("is indexable with its own canonical, hreflang and x-default", async () => {
    const meta = await generateMetadata(params("en"));
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe("https://www.corvo.tech/en/api-docs");
    expect(meta.alternates?.languages).toMatchObject({ pt: "https://www.corvo.tech/pt/api-docs", en: "https://www.corvo.tech/en/api-docs" });
  });

  it("is in the sitemap in both languages and not blocked by robots", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://www.corvo.tech/pt/api-docs");
    expect(urls).toContain("https://www.corvo.tech/en/api-docs");
    const rules = [robots().rules].flat() as { disallow?: string[] }[];
    for (const rule of rules) for (const path of rule.disallow ?? []) expect("/pt/api-docs".startsWith(path)).toBe(false);
  });

  it("redirects /api-docs with 301 to /pt/api-docs", async () => {
    const redirects = await (nextConfig as { redirects: () => Promise<{ source: string; destination: string; statusCode?: number }[]> }).redirects();
    expect(redirects).toContainEqual({ source: "/api-docs", destination: "/pt/api-docs", statusCode: 301 });
  });
});
