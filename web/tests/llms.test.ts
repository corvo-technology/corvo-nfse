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
        expect(index).toContain(`https://www.corvo.tech/${locale}/docs/${slug})`);
        expect(full).toContain(`Source: https://www.corvo.tech/${locale}/docs/${slug}`);
        expect(full).toContain(tree.pages[slug].title);
      }
    });
  }

  it("cross-links the two languages and uses the Maven coordinate from the Java SDK pom", () => {
    expect(buildLlmsTxt("en")).toContain("https://www.corvo.tech/pt/llms.txt");
    expect(buildLlmsTxt("pt")).toContain("https://www.corvo.tech/llms.txt");
    expect(buildLlmsTxt("pt")).toContain("https://www.corvo.tech/pt/llms-full.txt");
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
    const response = await localeFull(new Request("https://www.corvo.tech/pt/llms-full.txt"), { params: Promise.resolve({ locale: "pt" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });

  const CLIENTS = ["Claude Code", "Claude Desktop", "Cursor", "VS Code", "Codex", "Windsurf"];

  for (const locale of ["en", "pt"] as const) {
    it(`never mentions AGPL in ${locale}`, () => {
      expect(buildLlmsTxt(locale)).not.toMatch(/AGPL/i);
    });

    it(`lists the 6 MCP clients and the legal links in ${locale}`, () => {
      const index = buildLlmsTxt(locale);
      for (const client of CLIENTS) expect(index).toContain(client);
      for (const page of ["privacy", "terms", "dpa"]) expect(index).toContain(`https://www.corvo.tech/${locale}/${page})`);
    });

    it(`says MEI and Simples Nacional only in ${locale}, matching the regime rule`, () => {
      const index = buildLlmsTxt(locale);
      expect(index).not.toMatch(/other regimes need/i);
      expect(index).toMatch(locale === "en" ? /MEI and Simples Nacional only/ : /só MEI e Simples Nacional/);
    });
  }
});
