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

  it("describes NFS-e, NF-e and NFC-e, and follows the production switch", () => {
    const previous = process.env.NFE_PRODUCTION_ENABLED;
    try {
      delete process.env.NFE_PRODUCTION_ENABLED;
      expect(buildLlmsTxt("en")).toContain("NFC-e (retail, model 65)");
      expect(buildLlmsTxt("en")).toContain("production is coming soon");
      expect(buildLlmsTxt("pt")).toContain("a produção chega em breve");
      process.env.NFE_PRODUCTION_ENABLED = "true";
      expect(buildLlmsTxt("en")).toContain("NF-e and NFC-e issue in production");
      expect(buildLlmsTxt("pt")).toContain("A NF-e e a NFC-e emitem em produção");
    } finally {
      if (previous === undefined) delete process.env.NFE_PRODUCTION_ENABLED;
      else process.env.NFE_PRODUCTION_ENABLED = previous;
    }
  });

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
    it(`says the project is open source under AGPL-3.0 and links the repository in ${locale}`, () => {
      const index = buildLlmsTxt(locale);
      expect(index).toMatch(/AGPL-3\.0/);
      expect(index).toContain("https://github.com/corvo-technology/corvo-nfse");
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

  it("llms.txt names the three new MCP tools in both languages", () => {
    for (const locale of ["en", "pt"] as const) {
      const index = buildLlmsTxt(locale);
      for (const tool of ["certificate_upload", "credits_purchase", "payment_status"]) expect(index).toContain(tool);
    }
  });

  it("llms.txt documents nfse_review in both languages", () => {
    for (const locale of ["en", "pt"] as const) expect(buildLlmsTxt(locale)).toContain("nfse_review");
    for (const locale of ["en", "pt"] as const) {
      const page = JSON.stringify(getDocsTree(locale)!.pages.mcp.blocks);
      expect(page).toContain("nfse_review");
    }
  });

  it("the MCP docs page lists the optional scopes with the consent texts", () => {
    const pt = JSON.stringify(getDocsTree("pt")!.pages.mcp.blocks);
    expect(pt).toContain("nfse:certificates");
    expect(pt).toContain("Enviar o certificado digital da empresa");
    expect(pt).toContain("billing:purchase");
    expect(pt).toContain("O pagamento é sempre feito por você.");
    const en = JSON.stringify(getDocsTree("en")!.pages.mcp.blocks);
    expect(en).toContain("nfse:certificates");
    expect(en).toContain("billing:purchase");
    for (const page of [pt, en]) for (const tool of ["certificate_upload", "credits_purchase", "payment_status"]) expect(page).toContain(tool);
  });
});
