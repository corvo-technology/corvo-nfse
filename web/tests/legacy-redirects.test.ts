import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { LEGACY_REDIRECTS, proxy } from "@/proxy";
import { DOC_SLUGS } from "@/lib/docs/registry";

const LOCALE_DIR = join(__dirname, "..", "app", "[locale]");

describe("legacy URLs without locale", () => {
  it("has the 21 URLs from Search Console", () => {
    expect(Object.keys(LEGACY_REDIRECTS)).toHaveLength(21);
  });

  for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
    it(`${from} → 301 ${to}`, () => {
      const response = proxy(new NextRequest(`https://www.corvo.tech${from}`, { headers: { cookie: "NEXT_LOCALE=en" } }));
      expect(response.status).toBe(301);
      expect(new URL(response.headers.get("location")!).pathname).toBe(to);
    });
  }

  it("sends every URL to an existing pt page (one hop, no further redirect)", () => {
    for (const to of Object.values(LEGACY_REDIRECTS)) {
      expect(to.startsWith("/pt/")).toBe(true);
      const path = to.slice("/pt".length);
      const doc = path.match(/^\/docs\/(.+)$/)?.[1];
      if (doc) expect(DOC_SLUGS).toContain(doc);
      else expect(existsSync(join(LOCALE_DIR, path.slice(1), "page.tsx"))).toBe(true);
    }
  });
});
