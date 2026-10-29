import { describe, expect, it, vi } from "vitest";
import type { IntegrationConnection, IntegrationSale } from "@/lib/api";
import { ConnectError, connectProvider, connectionStatus, pendingCount, saleStatus } from "@/lib/integrations";

const connection = (over: Partial<IntegrationConnection> = {}): IntegrationConnection => ({
  id: "c1", provider: "woovi", environment: "test", companyId: "co1", state: "active", externalAccountId: "acc", activeFrom: null,
  webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB", createdAt: "2026-10-29T12:00:00Z", ...over,
});
const sale = (over: Partial<IntegrationSale> = {}): IntegrationSale => ({
  id: "s1", operationKey: "charge:1", commercialState: "paid", fiscalStatus: "submitted", blockReason: null, amountCents: 4990, currency: "BRL",
  customer: { name: "Maria", email: null, taxId: "52998224725", taxIdMasked: false }, paidAt: "2026-10-29T15:00:00Z", invoiceId: "inv1",
  createdAt: "2026-10-29T15:00:00Z", updatedAt: "2026-10-29T15:00:00Z", ...over,
});

describe("connectionStatus", () => {
  it.each([
    ["active", "active", "accent"], ["paused", "paused", "warn"], ["reauth_required", "reconnect", "danger"], ["draft", "draft", "gray"], ["disconnected", "disconnected", "gray"],
  ] as const)("%s -> %s", (state, key, tone) => {
    expect(connectionStatus(connection({ state }))).toEqual({ key, tone });
  });
});

describe("saleStatus", () => {
  it("an issued sale", () => expect(saleStatus(sale())).toMatchObject({ key: "issued", tone: "accent", canFixCustomer: false, canRetry: false }));
  it("a sale waiting for the customer document can be fixed", () => {
    expect(saleStatus(sale({ fiscalStatus: "needs_attention", blockReason: "customer_tax_id_missing", invoiceId: null }))).toMatchObject({ key: "waitingCustomer", tone: "warn", canFixCustomer: true, canRetry: false });
  });
  it.each(["invoice_rejected", "quota_exceeded", "company_not_ready", "no_rule", "ambiguous_rule"])("%s needs attention and can be retried", (blockReason) => {
    expect(saleStatus(sale({ fiscalStatus: "needs_attention", blockReason, invoiceId: null }))).toMatchObject({ key: "needsAttention", tone: "danger", canFixCustomer: false, canRetry: true });
  });
  it("a refund after the invoice is flagged but stays issued", () => {
    expect(saleStatus(sale({ commercialState: "refunded", blockReason: "refund_after_invoice" }))).toMatchObject({ key: "refundedAfterInvoice", tone: "warn" });
  });
  it.each(["refunded", "disputed"] as const)("a %s sale without invoice is not issued", (commercialState) => {
    expect(saleStatus(sale({ commercialState, fiscalStatus: "blocked", blockReason: commercialState, invoiceId: null }))).toMatchObject({ key: "notIssuedRefund", tone: "gray", canRetry: false });
  });
  it("a sale blocked because the connection was paused can be retried", () => {
    expect(saleStatus(sale({ fiscalStatus: "blocked", blockReason: "connection_inactive", invoiceId: null }))).toMatchObject({ key: "blocked", canRetry: true });
  });
  it("a sale from before the start date is blocked without a retry", () => {
    expect(saleStatus(sale({ fiscalStatus: "blocked", blockReason: "before_active_from", invoiceId: null }))).toMatchObject({ key: "blocked", canRetry: false });
  });
  it("a sale not yet processed", () => expect(saleStatus(sale({ fiscalStatus: "none", invoiceId: null }))).toMatchObject({ key: "processing", tone: "gray" }));
});

it("pendingCount counts only sales that need the customer's action", () => {
  expect(pendingCount([sale(), sale({ fiscalStatus: "needs_attention", blockReason: "customer_tax_id_missing", invoiceId: null }), sale({ fiscalStatus: "needs_attention", blockReason: "quota_exceeded", invoiceId: null }), sale({ fiscalStatus: "blocked", blockReason: "refunded", invoiceId: null })])).toBe(2);
});

describe("connectProvider", () => {
  const input = { provider: "woovi", companyId: "co1", environment: "test" as const, credentials: { appId: "abc" }, sendEmail: true };
  const api = () => ({
    create: vi.fn().mockResolvedValue(connection({ state: "draft", webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB?webhookSecret=s" })),
    validate: vi.fn().mockResolvedValue(connection()), putRules: vi.fn().mockResolvedValue([]), activate: vi.fn().mockResolvedValue(connection()), disconnect: vi.fn().mockResolvedValue(connection({ state: "disconnected" })),
  });

  it("creates, validates, sets the rule and activates, in that order, and returns the url from the create response", async () => {
    const calls: string[] = [];
    const a = api();
    for (const name of ["create", "validate", "putRules", "activate"] as const) a[name].mockImplementation(async () => { calls.push(name); return name === "create" ? connection({ state: "draft", webhookUrl: "URL?webhookSecret=s" }) : connection(); });
    const result = await connectProvider(input, a);
    expect(calls).toEqual(["create", "validate", "putRules", "activate"]);
    expect(result).toEqual({ connection: expect.objectContaining({ id: "c1" }), webhookUrl: "URL?webhookSecret=s", secrets: {} });
    expect(a.create).toHaveBeenCalledWith(expect.objectContaining({ provider: "woovi", companyId: "co1", environment: "test", credentials: { appId: "abc" }, activeFrom: expect.any(String) }));
    expect(a.putRules).toHaveBeenCalledWith("c1", [{ service: {}, sendEmail: true }]);
    expect(a.disconnect).not.toHaveBeenCalled();
  });
  it("a failure while creating leaves nothing to clean up", async () => {
    const a = api();
    a.create.mockRejectedValue(new Error("company not found"));
    await expect(connectProvider(input, a)).rejects.toMatchObject({ step: "create", message: "company not found" });
    expect(a.disconnect).not.toHaveBeenCalled();
  });
  it.each([["validate", "validate"], ["putRules", "rules"], ["activate", "activate"]] as const)("a failure at %s disconnects the new connection and names the step (%s)", async (call, step) => {
    const a = api();
    a[call].mockRejectedValue(new Error("boom"));
    const error = await connectProvider(input, a).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error).toMatchObject({ step, message: "boom" });
    expect(a.disconnect).toHaveBeenCalledWith("c1");
  });
  it("still reports the original error when the clean-up fails too", async () => {
    const a = api();
    a.validate.mockRejectedValue(new Error("Woovi recusou o AppID"));
    a.disconnect.mockRejectedValue(new Error("network"));
    await expect(connectProvider(input, a)).rejects.toMatchObject({ step: "validate", message: "Woovi recusou o AppID" });
  });
  it("sets no fixed description, so each invoice uses what the platform sent for that sale", async () => {
    const a = api();
    await connectProvider(input, a);
    expect(a.putRules).toHaveBeenCalledWith("c1", [{ service: {}, sendEmail: true }]);
  });
});
