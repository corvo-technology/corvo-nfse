import { describe, expect, it } from "vitest";
import { NFE_SLUGS } from "@/lib/docs/slugs";
import { getDocsTree } from "@/lib/docs/registry";
import type { DocBlock, DocsLocale, DocSection } from "@/lib/docs/types";
import { buildLlmsFull } from "@/lib/llms";

const allText = (blocks: DocBlock[]): string =>
  blocks
    .map((block) => {
      switch (block.kind) {
        case "text": case "callout": case "heading": return block.body;
        case "list": return block.items.join("\n");
        case "table": return [...block.head, ...block.rows.flat()].join("\n");
        case "code": return block.code;
        default: return "";
      }
    })
    .join("\n");
const page = (locale: DocsLocale, slug: string): DocSection => getDocsTree(locale)!.pages[slug as (typeof NFE_SLUGS)[number]];

describe("NFC-e docs", () => {
  it("the page is in the NF-e group", () => {
    expect(NFE_SLUGS).toContain("nfce");
  });

  it.each(["en", "pt"] as const)("%s: has a title, a description and content", (locale) => {
    const section = page(locale, "nfce");
    expect(section.title).toContain("NFC-e");
    expect(section.description?.length ?? 0).toBeGreaterThan(20);
    expect(section.blocks.length).toBeGreaterThan(5);
  });

  it.each(["en", "pt"] as const)("%s: says homologação first, SP first, and that no CSC is needed", (locale) => {
    const section = page(locale, "nfce");
    const warn = section.blocks.find((block) => block.kind === "callout" && block.tone === "warn");
    expect(warn).toBeTruthy();
    const body = (warn as { body: string }).body;
    expect(body).toMatch(/homologa/i);
    expect(body).toMatch(/SP/);
    const text = allText(section.blocks);
    expect(text).toContain("QR Code v3");
    expect(text).toContain("CSC");
    expect(text).toMatch(locale === "pt" ? /credenciamento/i : /accreditation/i);
  });

  it.each(["en", "pt"] as const)("%s: covers the type, consumer id limit, indPres, card, cancel in 30 minutes, no CC-e and the DANFCE", (locale) => {
    const text = allText(page(locale, "nfce").blocks);
    expect(text).toContain('type: "nfce"');
    expect(text).toContain("R$ 10.000");
    expect(text).toContain("NFCE_CONSUMER_ID_REQUIRED");
    expect(text).toContain("NFCE_DELIVERY_ADDRESS_REQUIRED");
    expect(text).toContain("indPres");
    expect(text).toContain("tBand");
    expect(text).toMatch(/30 (minutos|minutes)/);
    expect(text).toContain("INVOICE_OPERATION_NOT_SUPPORTED");
    expect(text).toContain("/v1/invoices/:id/pdf?layout=a4");
    expect(text).toContain("80 mm");
    expect(text).toContain("urlChave");
    expect(text).not.toMatch(/\/v1\/nfce/);
  });

  it.each(["en", "pt"] as const)("%s: lists every nfce.* webhook event the API sends", (locale) => {
    const text = allText(page(locale, "nfce").blocks);
    for (const event of ["authorized", "rejected", "denied", "failed", "reconciliation_required", "manual_review", "documents_ready", "email_sent", "email_failed", "cancelled", "cancellation_rejected"])
      expect(text, event).toContain(`nfce.document.${event}`);
    expect(text).toContain("nfce.inutilization.completed");
    expect(text).toContain("nfce.inutilization.rejected");
    expect(text).toContain("nfce.contingency.deadline_near");
  });

  it.each(["en", "pt"] as const)("%s: explains the off-line NFC-e: the request, the option off by default, 20 and 24 hours, the locked fields", (locale) => {
    const text = allText(page(locale, "nfce").blocks);
    expect(text).toContain('contingency: "offline"');
    expect(text).toContain("nfceAutoOffline");
    expect(text).toContain("contingency_pending");
    expect(text).toMatch(/20 (horas|hours)/);
    expect(text).toMatch(/24 (horas|hours)/);
    expect(text).toContain("NFCE_CONTINGENCY_FIELD_LOCKED");
    expect(text).toContain("NFCE_OFFLINE_NOT_AVAILABLE");
  });

  it.each(["en", "pt"] as const)("%s: the JSON examples are valid and the request one is an NFC-e without natOp", (locale) => {
    const blocks = page(locale, "nfce").blocks.filter((block) => block.kind === "code" && block.language === "json");
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) expect(() => JSON.parse((block as { code: string }).code)).not.toThrow();
    const request = JSON.parse((blocks[0] as { code: string }).code) as Record<string, unknown>;
    expect(request.type).toBe("nfce");
    expect(request).not.toHaveProperty("natOp");
  });

  it.each(["en", "pt"] as const)("%s: the MCP page names type nfce, nfe_validate with type and the model of inutilize", (locale) => {
    const text = allText(page(locale, "mcp").blocks);
    expect(text).toContain('type: "nfce"');
    expect(text).toContain("model");
    expect(text).toContain("nfce_default_series");
  });

  it.each(["en", "pt"] as const)("%s: the NF-e overview points to the NFC-e page", (locale) => {
    expect(allText(page(locale, "nfe").blocks)).toContain("NFC-e");
  });

  it("is in the llms-full export in both languages", () => {
    expect(buildLlmsFull("en")).toContain("NFC-e: consumer sale");
    expect(buildLlmsFull("pt")).toContain("NFC-e: venda ao consumidor");
  });
});
