import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

const LOCALE_DIR = join(__dirname, "..", "app", "[locale]");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mts)$/.test(name) ? [path] : [];
  });
}

describe("static marketing pages", () => {
  it("never read cookies() or headers() under app/[locale], which would make them dynamic", () => {
    const offenders = sourceFiles(LOCALE_DIR).filter((file) => {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      return /\b(cookies|headers|draftMode)\s*\(\s*\)/.test(source) || /from\s+["']next\/headers["']/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("prerenders both locales and revalidates the [locale] layout", async () => {
    const layout = await import("@/app/[locale]/layout");
    expect(layout.generateStaticParams()).toEqual([{ locale: "en" }, { locale: "pt" }]);
    expect(layout.dynamicParams).toBe(false);
    expect(layout.revalidate).toBeGreaterThan(0);
  });

  it("sends a public CDN cache header on marketing pages and keeps private screens noindex", async () => {
    const rules = await (nextConfig as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> }).headers();
    const marketing = rules.filter((rule) => rule.source.startsWith("/:locale"));
    expect(marketing.length).toBeGreaterThan(0);
    for (const rule of marketing) {
      const cache = rule.headers.find((header) => header.key === "Cache-Control")?.value ?? "";
      expect(cache).toMatch(/public/);
      expect(cache).toMatch(/s-maxage=\d+/);
    }
    expect(rules.find((rule) => rule.source === "/login")?.headers[0].key).toBe("X-Robots-Tag");
  });
});
