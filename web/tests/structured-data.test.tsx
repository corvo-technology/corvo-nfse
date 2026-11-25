import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { JsonLd } from "@/components/seo/json-ld";
import ApiDocsPage from "@/app/[locale]/api-docs/page";
import DocsSectionPage from "@/app/[locale]/docs/[...section]/page";
import StartPage from "@/app/[locale]/start/page";
import LandingPage from "@/app/[locale]/page";
import { SDKS } from "@/lib/sdks";
import { SITE_URL } from "@/lib/seo";
import { breadcrumbList, docsCrumbs, sdkSourceCode } from "@/lib/structured-data";

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getTranslations: async () => (key: string) => key,
}));

function jsonLd(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(jsonLd);
  if (!isValidElement(node)) return [];
  const props = node.props as { data?: unknown; children?: ReactNode };
  if (node.type === JsonLd) return ([] as Record<string, unknown>[]).concat(props.data as Record<string, unknown>);
  return jsonLd(props.children);
}

type Item = { position: number; name: string; item: string };
const items = (list: Record<string, unknown> | undefined) => (list?.itemListElement ?? []) as Item[];

describe("structured data", () => {
  it("breadcrumbs are numbered from 1 and use absolute www URLs", () => {
    const list = breadcrumbList(docsCrumbs("pt", { name: "Faturas", url: `${SITE_URL}/pt/docs/invoices` }));
    expect(items(list).map((c) => c.position)).toEqual([1, 2, 3]);
    for (const c of items(list)) expect(c.item.startsWith(`${SITE_URL}/`)).toBe(true);
  });

  it.each(["pt", "en"] as const)("%s api-docs has a TechArticle and a BreadcrumbList ending at the page", async (locale) => {
    const data = jsonLd(await ApiDocsPage({ params: Promise.resolve({ locale }) }));
    expect(data.find((d) => d["@type"] === "TechArticle")).toMatchObject({ url: `${SITE_URL}/${locale}/api-docs` });
    const list = items(data.find((d) => d["@type"] === "BreadcrumbList"));
    expect(list).toHaveLength(3);
    expect(list.at(-1)?.item).toBe(`${SITE_URL}/${locale}/api-docs`);
  });

  it.each(["pt", "en"] as const)("%s start page has HowTo and BreadcrumbList", async (locale) => {
    const data = jsonLd(await StartPage({ params: Promise.resolve({ locale }) }));
    expect(data.map((d) => d["@type"])).toEqual(["HowTo", "BreadcrumbList"]);
  });

  it.each(["pt", "en"] as const)("%s sdks docs page lists every official SDK as SoftwareSourceCode, other pages do not", async (locale) => {
    const sdks = jsonLd(await DocsSectionPage({ params: Promise.resolve({ locale, section: ["sdks"] }) }));
    const list = sdks.find((d) => d["@type"] === "ItemList");
    expect(items(list)).toHaveLength(SDKS.length);
    expect(JSON.stringify(list)).toContain("SoftwareSourceCode");
    expect(sdkSourceCode(locale)).toEqual(list);
    const other = jsonLd(await DocsSectionPage({ params: Promise.resolve({ locale, section: ["errors"] }) }));
    expect(other.map((d) => d["@type"])).toEqual(["TechArticle", "BreadcrumbList"]);
  });

  it.each(["pt", "en"] as const)("%s landing offers are all BRL with a numeric price, no ratings, unique @ids", async (locale) => {
    const data = jsonLd(await LandingPage({ params: Promise.resolve({ locale }) }));
    const software = data.find((d) => d["@type"] === "SoftwareApplication") as { offers: { price: string; priceCurrency: string }[] };
    expect(software.offers).toHaveLength(5);
    for (const offer of software.offers) {
      expect(offer.priceCurrency).toBe("BRL");
      expect(Number.isFinite(Number(offer.price))).toBe(true);
    }
    expect(JSON.stringify(data)).not.toMatch(/AggregateRating|"Review"|SearchAction/);
    const ids = data.map((d) => d["@id"]).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
