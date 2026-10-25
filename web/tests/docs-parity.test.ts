// tests/docs-parity.test.ts
import { describe, expect, it } from "vitest";
import { DOC_SLUGS, getDocsTree } from "@/lib/docs/registry";
import type { DocBlock, DocsTree } from "@/lib/docs/types";

const en = getDocsTree("en") as DocsTree;
const pt = getDocsTree("pt") as DocsTree;

function endpoints(blocks: DocBlock[]) {
  return blocks.filter((b): b is Extract<DocBlock, { kind: "endpoint" }> => b.kind === "endpoint");
}

function describeSection(tree: DocsTree, section: { blocks: DocBlock[] }) {
  return {
    blockKinds: section.blocks.map((b) => b.kind),
    endpoints: endpoints(section.blocks).map((e) => `${e.method} ${e.path}`),
    tableRows: section.blocks
      .filter((b): b is Extract<DocBlock, { kind: "table" }> => b.kind === "table")
      .map((t) => t.rows.length),
  };
}

describe("EN/PT docs parity", () => {
  it("has identical chrome keys", () => {
    expect(Object.keys(en.chrome.groups)).toEqual(Object.keys(pt.chrome.groups));
    expect(Object.keys(en.chrome.copy.table)).toEqual(Object.keys(pt.chrome.copy.table));
  });

  it("has identical pages and home structure", () => {
    expect(Object.keys(en.pages).sort()).toEqual(Object.keys(pt.pages).sort());
    expect(Object.keys(en.pages).sort()).toEqual([...DOC_SLUGS].sort());
    expect(describeSection(en, en.home)).toEqual(describeSection(pt, pt.home));
  });

  it.each(DOC_SLUGS)("page '%s' has identical structure in EN and PT", (slug) => {
    expect(describeSection(en, en.pages[slug])).toEqual(describeSection(pt, pt.pages[slug]));
  });

  it("documents exactly 34 endpoint operations", () => {
    const allEndpoints = DOC_SLUGS.flatMap((slug) => endpoints(pt.pages[slug].blocks));
    const unique = new Set(allEndpoints.map((e) => `${e.method} ${e.path}`));
    expect(allEndpoints).toHaveLength(34);
    expect(unique.size).toBe(34);
  });

  it("every endpoint has curl and node examples plus a response", () => {
    for (const slug of DOC_SLUGS) {
      for (const e of endpoints(en.pages[slug].blocks)) {
        expect(e.examples.curl.length).toBeGreaterThan(0);
        expect(e.examples.node.length).toBeGreaterThan(0);
        expect(e.response.label.length).toBeGreaterThan(0);
        expect(e.scopes.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("MEI and Simples Nacional focus in the docs", () => {
  const everyBlock = (tree: DocsTree) => [tree.home, ...DOC_SLUGS.map((slug) => tree.pages[slug])].flatMap((section) => section.blocks);
  it.each([["en", en], ["pt", pt]] as const)("documents the monthly Simples rate endpoints in %s", (_lang, tree) => {
    const found = DOC_SLUGS.flatMap((slug) => endpoints(tree.pages[slug].blocks)).map((e) => `${e.method} ${e.path}`);
    expect(found).toContain("GET /v1/companies/:id/simples-rates");
    expect(found).toContain("PUT /v1/companies/:id/simples-rates/:month");
    const tables = everyBlock(tree).filter((b): b is Extract<DocBlock, { kind: "table" }> => b.kind === "table");
    expect(tables.some((t) => t.rows.some((row) => row[0] === "PUT" && row[1] === "`/v1/companies/:id/simples-rates/:month`"))).toBe(true);
    expect(tables.some((t) => t.rows.some((row) => row[0] === "`company_set_simples_rate`"))).toBe(true);
    expect(tables.some((t) => t.rows.some((row) => String(row[0]).includes("ERROR_TAX_REGIME_NOT_SUPPORTED")))).toBe(true);
  });
  it.each([["en", en], ["pt", pt]] as const)("does not offer Lucro Presumido or Lucro Real as accepted regimes in %s", (_lang, tree) => {
    const params = DOC_SLUGS.flatMap((slug) => endpoints(tree.pages[slug].blocks)).flatMap((e) => e.params?.rows ?? []);
    const regimeRows = params.filter((row) => row.name === "taxRegime");
    expect(regimeRows.length).toBeGreaterThan(0);
    for (const row of regimeRows) {
      expect(row.description).not.toMatch(/Lucro Presumido.*(or|ou).*Lucro Real/);
      expect(row.description).toContain("ERROR_TAX_REGIME_NOT_SUPPORTED");
    }
  });
});
