import { describe, expect, it } from "vitest";
import { getDocsTree } from "@/lib/docs/registry";
import type { DocsTree } from "@/lib/docs/types";

const ROUTES = [
  "/v1/integrations/providers",
  "/v1/integrations/connections",
  "/v1/integrations/connections/:id",
  "/v1/integrations/connections/:id/validate",
  "/v1/integrations/connections/:id/activate",
  "/v1/integrations/connections/:id/pause",
  "/v1/integrations/connections/:id/disconnect",
  "/v1/integrations/connections/:id/rules",
  "/v1/integrations/connections/:id/events",
  "/v1/integrations/connections/:id/operations",
  "/v1/integrations/operations/:id/customer",
  "/v1/integrations/operations/:id/retry",
  "/v1/integrations/inbound/:publicId",
];

describe.each(["pt", "en"] as const)("payment integrations docs (%s)", (locale) => {
  const tree = getDocsTree(locale) as DocsTree;
  const page = tree.pages["payment-integrations"];
  const text = JSON.stringify(page);

  it("has a page with a title and a description", () => {
    expect(page.title.length).toBeGreaterThan(3);
    expect(page.description?.length ?? 0).toBeGreaterThan(10);
  });

  it.each(ROUTES)("documents %s", (route) => {
    expect(text).toContain(route);
  });

  it("explains the permissions, the pending reasons and that a refund never cancels an invoice", () => {
    expect(text).toContain("integrations.manage");
    expect(text).toContain("customer_tax_id_missing");
    expect(text).toContain("refund_after_invoice");
    expect(text).toContain("/v1/invoices/:id/cancel");
  });

  it("documents how to connect Woovi and AbacatePay", () => {
    for (const term of ["OPENPIX:CHARGE_COMPLETED", "webhookToken", "Authorization", "webhookSecret", "checkout.completed", "devMode"])
      expect(text).toContain(term);
  });

  it("documents how to connect Stripe", () => {
    for (const term of ["rk_", "whsec_", "Stripe-Signature", "charge.succeeded", "charge.refunded", "charge.dispute.created", "stripe_charge", "tax_id_collection", "livemode"])
      expect(text).toContain(term);
  });

  it("documents how to connect Kiwify", () => {
    for (const term of ["?signature=", "HMAC-SHA1", "order_approved", "kiwify:<order_id>", "invoiceValue", "my_commission", "chargeback", "token"])
      expect(text.toLowerCase()).toContain(term.toLowerCase());
  });

  it("documents how to connect Hotmart", () => {
    for (const term of ["hottok", "X-HOTMART-HOTTOK", "PURCHASE_APPROVED", "PURCHASE_COMPLETE", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK", "PURCHASE_PROTEST", "hotmart:<transaction>", "invoice_by", "invoiceValue"])
      expect(text).toContain(term);
  });

  it("documents how to connect Eduzz", () => {
    for (const term of ["secretKey", "x-signature", "HMAC-SHA256", "myeduzz.invoice_paid", "myeduzz.invoice_refunded", "myeduzz.invoice_chargeback", "myeduzz.invoice_canceled", "eduzz:<", "invoiceValue", "data.gains.producer"])
      expect(text).toContain(term);
  });

  it("authenticates the examples with X-API-Key, like the rest of the API", () => {
    expect(text).toContain("X-API-Key");
    expect(text).not.toContain("Authorization: Bearer");
  });
});
