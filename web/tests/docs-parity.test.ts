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

  it("documents exactly 33 endpoint operations", () => {
    const allEndpoints = DOC_SLUGS.flatMap((slug) => endpoints(pt.pages[slug].blocks));
    const unique = new Set(allEndpoints.map((e) => `${e.method} ${e.path}`));
    expect(allEndpoints).toHaveLength(33);
    expect(unique.size).toBe(33);
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
