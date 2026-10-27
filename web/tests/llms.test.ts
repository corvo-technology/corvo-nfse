import { describe, expect, it } from "vitest";
import { DOC_SLUGS, getDocsTree } from "@/lib/docs/registry";
import { buildLlmsFull, buildLlmsTxt } from "@/lib/llms";
import { GET as rootIndex } from "@/app/llms.txt/route";
import { GET as localeFull } from "@/app/[locale]/llms-full.txt/route";

describe("llms.txt and llms-full.txt", () => {
  for (const locale of ["en", "pt"] as const) {
    it(`lists every doc page in ${locale}`, () => {
      const index = buildLlmsTxt(locale);
      const full = buildLlmsFull(locale);
      const tree = getDocsTree(locale)!;
      for (const slug of DOC_SLUGS) {
        expect(index).toContain(`https://corvo.tech/${locale}/docs/${slug})`);
        expect(full).toContain(`Source: https://corvo.tech/${locale}/docs/${slug}`);
        expect(full).toContain(tree.pages[slug].title);
      }
    });
  }

  it("cross-links the two languages and uses the Maven coordinate from the Java SDK pom", () => {
    expect(buildLlmsTxt("en")).toContain("https://corvo.tech/pt/llms.txt");
    expect(buildLlmsTxt("pt")).toContain("https://corvo.tech/llms.txt");
    expect(buildLlmsTxt("pt")).toContain("https://corvo.tech/pt/llms-full.txt");
    for (const locale of ["en", "pt"] as const) {
      expect(buildLlmsTxt(locale)).toContain("tech.corvo:corvo-nfse");
      expect(buildLlmsTxt(locale)).not.toContain("technology.corvo:corvo-nfse");
    }
  });

  it("only links to doc pages that exist", () => {
    const linked = [...buildLlmsTxt("en").matchAll(/corvo\.tech\/en\/docs\/([a-z-]+)/g)].map((match) => match[1]);
    for (const slug of linked) expect(DOC_SLUGS).toContain(slug);
  });

  it("serves text/markdown", async () => {
    expect(rootIndex().headers.get("content-type")).toContain("text/markdown");
    const response = await localeFull(new Request("https://corvo.tech/pt/llms-full.txt"), { params: Promise.resolve({ locale: "pt" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });
});
