import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { DOC_SLUGS } from "@/lib/docs/registry";
import { getDocsTree } from "@/lib/docs/registry";
import { sectionToMarkdown } from "@/lib/docs/to-markdown";
import { SITE_COPY, localizedAlternates, pageMetadata, pageUrl } from "@/lib/seo";

describe("page metadata", () => {
  it("gives every page its own canonical and both languages", () => {
    expect(localizedAlternates("pt", "/docs/invoices")).toEqual({
      canonical: "https://www.corvo.tech/pt/docs/invoices",
      languages: {
        en: "https://www.corvo.tech/en/docs/invoices",
        pt: "https://www.corvo.tech/pt/docs/invoices",
        "x-default": "https://www.corvo.tech/pt/docs/invoices",
      },
    });
  });

  it("builds Open Graph and Twitter cards with the shared image in the page language", () => {
    const meta = pageMetadata({ locale: "pt", path: "/docs", title: "Docs", description: "d" });
    expect(meta.openGraph).toMatchObject({ locale: "pt_BR", url: pageUrl("pt", "/docs"), siteName: "Corvo" });
    expect(JSON.stringify(meta.openGraph?.images)).toContain("/og-corvo-1200x630.png");
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: ["/og-corvo-1200x630.png"] });
  });

  it("keeps titles and descriptions within search result limits", () => {
    for (const copy of Object.values(SITE_COPY)) {
      expect(copy.title.length).toBeLessThanOrEqual(60);
      expect(copy.description.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("robots and sitemap", () => {
  it("lets crawlers reach the docs and blocks only private screens", () => {
    const rules = robots().rules as { userAgent: string; disallow: string[] }[];
    for (const rule of rules) {
      expect(rule.disallow).toEqual(["/app/", "/login", "/mcp/", "/api/"]);
      expect(rule.disallow).not.toContain("/docs");
    }
  });

  it("allows each AI crawler explicitly and has no Host directive", () => {
    const result = robots();
    expect(result).not.toHaveProperty("host");
    expect(result).toMatchInlineSnapshot(`
      {
        "rules": [
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "*",
          },
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "GPTBot",
          },
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "OAI-SearchBot",
          },
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "ChatGPT-User",
          },
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "ClaudeBot",
          },
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "Claude-User",
          },
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "PerplexityBot",
          },
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "Google-Extended",
          },
          {
            "allow": "/",
            "disallow": [
              "/app/",
              "/login",
              "/mcp/",
              "/api/",
            ],
            "userAgent": "Applebot-Extended",
          },
        ],
        "sitemap": "https://www.corvo.tech/sitemap.xml",
      }
    `);
  });

  it("lists every page in both languages with hreflang alternates", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain("https://www.corvo.tech/en");
    expect(urls).toContain("https://www.corvo.tech/pt");
    for (const slug of DOC_SLUGS) {
      expect(urls).toContain(`https://www.corvo.tech/en/docs/${slug}`);
      expect(urls).toContain(`https://www.corvo.tech/pt/docs/${slug}`);
    }
    expect(new Set(urls).size).toBe(urls.length);
    expect(entries[0].alternates?.languages).toMatchObject({ en: "https://www.corvo.tech/en", pt: "https://www.corvo.tech/pt", "x-default": "https://www.corvo.tech/pt" });
    for (const entry of entries) {
      const xDefault = entry.alternates?.languages?.["x-default" as keyof typeof entry.alternates.languages];
      expect(xDefault).toMatch(/^https:\/\/www\.corvo\.tech\/pt(\/|$)/);
    }
  });
});

describe("llms-full", () => {
  it("renders documentation pages as Markdown", () => {
    const tree = getDocsTree("en")!;
    const markdown = sectionToMarkdown(tree.pages.invoices, 2);
    expect(markdown).toContain("## Invoices");
    expect(markdown).toContain("### POST /v1/invoices");
    expect(markdown).toContain("| Name | Type | Required | Description |");
  });
});

describe("start page", () => {
  it("is in the sitemap in both languages, and /login stays blocked", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://www.corvo.tech/pt/start");
    expect(urls).toContain("https://www.corvo.tech/en/start");
    for (const rule of [robots().rules].flat() as { disallow: string[] }[]) expect(rule.disallow).toContain("/login");
  });
});

describe("sitemap coverage", () => {
  it("lists every public page under app/[locale] with lastModified", async () => {
    const { readdirSync, statSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "..", "app", "[locale]");
    const pages = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, "page.tsx")));
    const urls = sitemap().map((entry) => entry.url);
    for (const name of pages) expect(urls).toContain(`https://www.corvo.tech/pt/${name}`);
    for (const entry of sitemap()) expect(entry.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
