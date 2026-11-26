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
const nfeText = (locale: DocsLocale) => NFE_SLUGS.map((slug) => allText(page(locale, slug).blocks)).join("\n");

describe("NF-e docs", () => {
  it.each(["en", "pt"] as const)("%s: the six pages exist, with a title, a description and content", (locale) => {
    for (const slug of NFE_SLUGS) {
      const section = page(locale, slug);
      expect(section.title.length, slug).toBeGreaterThan(3);
      expect(section.description?.length ?? 0, slug).toBeGreaterThan(20);
      expect(section.blocks.length, slug).toBeGreaterThan(2);
    }
  });

  it.each(["en", "pt"] as const)("%s: says in highlight that it is test mode, Simples Nacional, and that Corvo does not calculate taxes", (locale) => {
    const overview = page(locale, "nfe");
    const warn = overview.blocks.find((block) => block.kind === "callout" && block.tone === "warn");
    expect(warn).toBeTruthy();
    const body = (warn as { body: string }).body;
    expect(body).toMatch(/homologa/i);
    expect(body).toMatch(/Simples Nacional/);
    expect(body).toMatch(/CSOSN/);
    expect(body).toMatch(locale === "pt" ? /não calcula imposto/ : /does not calculate taxes/);
    expect(body).toMatch(/SP/);
    expect(body).toMatch(/SVRS/);
  });

  it.each(["en", "pt"] as const)("%s: covers every unified route (no /v1/nfe) and the type", (locale) => {
    const text = nfeText(locale);
    for (const route of ["/v1/invoices/validate", "/v1/invoices`", "/v1/invoices/:id/sync", "/v1/invoices/:id/discard", "/v1/invoices/:id/cancel", "/v1/invoices/:id/corrections", "/v1/invoices/:id/events", "/v1/invoices/:id/download-url", "/v1/invoices/inutilizations", "/v1/invoices/number-gaps", "/v1/companies/:id/nfe-settings"])
      expect(text, route).toContain(route);
    expect(text).toContain('type: "nfe"');
    expect(text).not.toMatch(/\/v1\/nfe(?![-\w])/);
    expect(text).toContain("INVOICE_OPERATION_NOT_SUPPORTED");
  });

  it.each(["en", "pt"] as const)("%s: lists every nfe.* webhook event the API sends", (locale) => {
    const text = nfeText(locale);
    for (const event of ["authorized", "cancellation_rejected", "cancelled", "corrected", "denied", "documents_ready", "email_failed", "email_sent", "failed", "manual_review", "reconciliation_required", "rejected"])
      expect(text, event).toContain(`nfe.document.${event}`);
    expect(text).toContain("nfe.inutilization.completed");
    expect(text).toContain("nfe.inutilization.rejected");
  });

  it.each(["en", "pt"] as const)("%s: explains each error type and the main codes", (locale) => {
    const text = allText(page(locale, "nfe-errors").blocks);
    for (const word of ["validation", "configuration", "communication", "NFE_VALIDATION_FAILED", "COMPANY_NFE_INCOMPLETE", "STATE_REGISTRATION_INVALID", "UF_NOT_ENABLED", "NFE_PRODUCTION_DISABLED", "IDEMPOTENCY_KEY_REUSED"])
      expect(text, word).toContain(word);
  });

  it.each(["en", "pt"] as const)("%s: the MCP page names the NF-e tools and the type", (locale) => {
    const text = allText(page(locale, "mcp").blocks);
    for (const tool of ["nfe_validate", "nfe_correct", "nfe_inutilize", "nfe_number_gaps", "nfe_settings_get", "nfe_settings_update"]) expect(text, tool).toContain(tool);
    expect(text).toContain('type: "all"');
  });

  it("is in the llms-full export in both languages", () => {
    expect(buildLlmsFull("en")).toContain("NF-e: validate, issue and follow");
    expect(buildLlmsFull("pt")).toContain("NF-e: validar, emitir e acompanhar");
  });
});
