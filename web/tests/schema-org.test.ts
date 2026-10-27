import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ORGANIZATION_SAME_AS, ORGANIZATION_URL, SITE_URL } from "@/lib/seo";
import { PLANS } from "@/lib/plans-catalog";

const ROOT = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|json)$/.test(name) ? [path] : [];
  });

describe("schema.org", () => {
  it("has no FAQPage anywhere in the app (pending approval of the FAQ text)", () => {
    const offenders = [...files(join(ROOT, "app")), ...files(join(ROOT, "components")), ...files(join(ROOT, "lib"))].filter((file) =>
      readFileSync(file, "utf8").includes("FAQPage"),
    );
    expect(offenders).toEqual([]);
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

  it("offers all 5 plans from the catalog", () => {
    expect(PLANS.map((plan) => plan.slug)).toEqual(["free", "developer", "growth", "scale", "volume"]);
    const page = readFileSync(join(ROOT, "app", "[locale]", "page.tsx"), "utf8");
    expect(page).toContain("offers: PLANS.map(");
  });

  it("marks every docs page as TechArticle with a BreadcrumbList", () => {
    for (const file of [join(ROOT, "app", "[locale]", "docs", "page.tsx"), join(ROOT, "app", "[locale]", "docs", "[...section]", "page.tsx")]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('"TechArticle"');
      expect(source).toContain('"BreadcrumbList"');
    }
  });
});
