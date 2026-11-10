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

  it("documents exactly 40 endpoint operations", () => {
    const allEndpoints = DOC_SLUGS.flatMap((slug) => endpoints(pt.pages[slug].blocks));
    const unique = new Set(allEndpoints.map((e) => `${e.method} ${e.path}`));
    expect(allEndpoints).toHaveLength(40);
    expect(unique.size).toBe(40);
  });

  it.each([["en", en], ["pt", pt]] as const)("documents POST /v1/invoices/batches in the %s endpoint table and reference", (_lang, tree) => {
    const reference = DOC_SLUGS.flatMap((slug) => endpoints(tree.pages[slug].blocks)).find(
      (e) => e.method === "POST" && e.path === "/v1/invoices/batches",
    );
    expect(reference?.success).toBe("202 Accepted");
    expect(reference?.summary).toContain("50");
    const tables = DOC_SLUGS.flatMap((slug) => tree.pages[slug].blocks).concat(tree.home.blocks).filter(
      (b): b is Extract<DocBlock, { kind: "table" }> => b.kind === "table",
    );
    expect(
      tables.some((t) => t.rows.some((row) => row[0] === "POST" && row[1] === "`/v1/invoices/batches`")),
    ).toBe(true);
    expect(
      tables.some((t) => t.rows.some((row) => row[0] === "`nfse_issue_batch`")),
    ).toBe(true);
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
  it.each([["en", en], ["pt", pt]] as const)("asks for the Simples rate on the company and has no monthly rate endpoint in %s", (_lang, tree) => {
    const all = DOC_SLUGS.flatMap((slug) => endpoints(tree.pages[slug].blocks));
    expect(all.map((e) => e.path).filter((path) => path.includes("simples-rates"))).toEqual([]);
    const create = all.find((e) => e.method === "POST" && e.path === "/v1/companies");
    expect(create?.params?.rows.map((row) => row.name)).toEqual(expect.arrayContaining(["simplesRate", "simplesIssRate"]));
    const tables = everyBlock(tree).filter((b): b is Extract<DocBlock, { kind: "table" }> => b.kind === "table");
    expect(tables.some((t) => t.rows.some((row) => String(row[0]).includes("company_set_simples_rate")))).toBe(false);
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
