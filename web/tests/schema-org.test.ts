import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { ORGANIZATION_SAME_AS, ORGANIZATION_URL, SITE_URL } from "@/lib/seo";
import { isValidElement, type ReactNode } from "react";
import { JsonLd } from "@/components/seo/json-ld";
import LandingPage from "@/app/[locale]/page";
import DocsHomePage from "@/app/[locale]/docs/page";

vi.mock("next-intl/server", () => ({ setRequestLocale: () => undefined }));

/** Collects the data of every <JsonLd> in a rendered server-component tree. */
function jsonLd(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(jsonLd);
  if (!isValidElement(node)) return [];
  const props = node.props as { data?: unknown; children?: ReactNode };
  if (node.type === JsonLd) return ([] as Record<string, unknown>[]).concat(props.data as Record<string, unknown>);
  return jsonLd(props.children);
}

const ROOT = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|json)$/.test(name) ? [path] : [];
  });

describe("schema.org", () => {
  it("builds FAQPage in one place only, from the landing FAQ text (so it cannot drift from the page)", () => {
    const offenders = [...files(join(ROOT, "app")), ...files(join(ROOT, "components")), ...files(join(ROOT, "lib"))]
      .filter((file) => readFileSync(file, "utf8").includes("FAQPage"))
      .map((file) => file.slice(ROOT.length + 1));
    expect(offenders).toEqual(["lib/landing-faq.ts"]);
  });

  it.each(["pt", "en"] as const)("%s landing JSON-LD has a FAQPage with the five questions, each answer pointing at a page of the site", async (locale) => {
    const faq = jsonLd(await LandingPage({ params: Promise.resolve({ locale }) })).find((item) => item["@type"] === "FAQPage") as Record<string, unknown>;
    expect(faq).toMatchObject({ "@id": `${SITE_URL}/${locale}#faq`, inLanguage: locale === "pt" ? "pt-BR" : "en", isPartOf: { "@id": `${SITE_URL}/#website` } });
    const entities = faq.mainEntity as { "@type": string; name: string; acceptedAnswer: { "@type": string; text: string; url: string } }[];
    expect(entities).toHaveLength(5);
    const known = new Set(sitemap().map((entry) => entry.url));
    for (const entity of entities) {
      expect(entity["@type"]).toBe("Question");
      expect(entity.name.endsWith("?")).toBe(true);
      expect(entity.acceptedAnswer["@type"]).toBe("Answer");
      expect(entity.acceptedAnswer.text.length).toBeGreaterThan(80);
      expect(entity.acceptedAnswer.text).not.toMatch(/<[a-z]/i);
      expect(known.has(entity.acceptedAnswer.url)).toBe(true);
    }
  });

  it("links the organization to its official profiles", () => {
    expect(ORGANIZATION_SAME_AS).toContain("https://github.com/corvo-technology");
    for (const url of ORGANIZATION_SAME_AS) expect(url).toMatch(/^https:\/\//);
  });

  it("keeps one Organization url for both languages and no unverified X profile", () => {
    expect(ORGANIZATION_URL).toBe(SITE_URL);
    const layout = readFileSync(join(ROOT, "app", "[locale]", "layout.tsx"), "utf8");
    expect(layout).toContain("url: ORGANIZATION_URL");
    for (const url of ORGANIZATION_SAME_AS) expect(url).not.toMatch(/(x|twitter)\.com/);
  });

  it.each(["pt", "en"])("%s landing JSON-LD is a SoftwareApplication linked to the Organization", async (locale) => {
    const [software] = jsonLd(await LandingPage({ params: Promise.resolve({ locale }) }));
    expect(software).toMatchObject({
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      provider: { "@id": `${SITE_URL}/#organization` },
      url: `${SITE_URL}/${locale}`,
    });
  });

  it.each(["pt", "en"])("%s docs home JSON-LD has a TechArticle and a BreadcrumbList", async (locale) => {
    const data = jsonLd(await DocsHomePage({ params: Promise.resolve({ locale }) }));
    const article = data.find((item) => item["@type"] === "TechArticle");
    const breadcrumb = data.find((item) => item["@type"] === "BreadcrumbList");
    expect(article).toMatchObject({ url: `${SITE_URL}/${locale}/docs`, publisher: { "@id": `${SITE_URL}/#organization` } });
    expect((breadcrumb?.itemListElement as unknown[]).length).toBe(2);
  });

  it("marks every docs page as TechArticle with a BreadcrumbList", () => {
    for (const file of [join(ROOT, "app", "[locale]", "docs", "page.tsx"), join(ROOT, "app", "[locale]", "docs", "[...section]", "page.tsx")]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('"TechArticle"');
      expect(source).toContain('"BreadcrumbList"');
    }
  });
});
