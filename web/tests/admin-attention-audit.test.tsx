// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import AttentionPage from "@/app/(dashboard)/app/admin/attention/page";
import AuditPage from "@/app/(dashboard)/app/admin/audit/page";
import { DeploymentConfigProvider } from "@/lib/deployment-config-context";
import { CLOUD_DEFAULT_CONFIG } from "@/lib/deployment-config";
import type { PlatformAttention, PlatformAuditEvent } from "@/lib/platform-admin";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ attention: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/platform-admin", async (original) => ({
  ...(await original<typeof import("@/lib/platform-admin")>()),
  platformAdmin: { attention: mocks.attention, audit: mocks.audit },
}));

const ta = messages.Admin.attention;
const fmtAttention = createTranslator({ locale: "en", messages, namespace: "Admin.attention" });
const tu = messages.Admin.audit;

const FULL: PlatformAttention = {
  staleInvoices: [{ invoiceId: "inv-1", tenantId: "t-1", userId: "u-stale", status: "processing", updatedAt: "2026-11-20T10:00:00Z" }],
  expiringCertificates: [{ companyId: "c-1", tenantId: "t-2", userId: "u-cert", taxId: "12345678000190", validUntil: "2026-12-01T00:00:00Z" }],
  failingWebhooks: [{ tenantId: "t-3", userId: "u-hook", failedCount24h: 7, lastFailureAt: "2026-11-22T10:00:00Z" }],
  failedPayments: [{ tenantId: "t-4", userId: "u-pay", source: "subscription", status: "rejected", at: "2026-11-22T11:00:00Z" }],
};
const EMPTY: PlatformAttention = { staleInvoices: [], expiringCertificates: [], failingWebhooks: [], failedPayments: [] };

function renderPage(ui: React.ReactElement, billingEnabled = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DeploymentConfigProvider config={{ ...CLOUD_DEFAULT_CONFIG, billingEnabled }}>{ui}</DeploymentConfigProvider>
    </NextIntlClientProvider>,
  );
}
afterEach(() => { cleanup(); mocks.attention.mockReset(); mocks.audit.mockReset(); });

describe("AttentionPage", () => {
  it("renders the four lists, each item linking to the user", async () => {
    mocks.attention.mockResolvedValue(FULL);
    renderPage(<AttentionPage />);
    await screen.findByText(ta.staleInvoices);
    for (const id of ["u-stale", "u-cert", "u-hook", "u-pay"]) {
      expect(document.querySelector(`a[href="/app/admin/users/${id}"]`), id).not.toBeNull();
    }
    for (const heading of [ta.staleInvoices, ta.expiringCertificates, ta.failingWebhooks, ta.failedPayments]) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(screen.getByText(fmtAttention("failedCount", { count: 7 }))).toBeTruthy();
    expect(screen.queryByText(ta.emptySection)).toBeNull();
  });

  it("shows emptySection for every empty list", async () => {
    mocks.attention.mockResolvedValue(EMPTY);
    renderPage(<AttentionPage />);
    await waitFor(() => expect(screen.getAllByText(ta.emptySection)).toHaveLength(4));
  });

  it("hides failed payments on self-hosted", async () => {
    mocks.attention.mockResolvedValue(FULL);
    renderPage(<AttentionPage />, false);
    await screen.findByText(ta.staleInvoices);
    expect(screen.queryByText(ta.failedPayments)).toBeNull();
    expect(document.querySelector('a[href="/app/admin/users/u-pay"]')).toBeNull();
  });

  it("shows an error when loading fails", async () => {
    mocks.attention.mockRejectedValue(new Error("boom"));
    renderPage(<AttentionPage />);
    expect(await screen.findByText(messages.Admin.common.loadFailed)).toBeTruthy();
  });
});

const ev = (id: string, over: Partial<PlatformAuditEvent> = {}): PlatformAuditEvent => ({
  id, actorEmail: "owner@corvo.tech", action: "credit_grant", targetTenantId: "t-1", targetUserId: "u-1",
  reason: `reason ${id}`, payload: {}, success: true, createdAt: "2026-11-22T10:00:00Z", ...over,
});

describe("AuditPage", () => {
  it("lists events in API order with actor, translated action, target, reason and result", async () => {
    mocks.audit.mockResolvedValue({
      items: [ev("a", { createdAt: "2026-11-23T10:00:00Z" }), ev("b", { action: "user_viewed", reason: null, success: false, targetUserId: "u-2" })],
      hasMore: false, nextCursor: null,
    });
    renderPage(<AuditPage />);
    await screen.findAllByText(tu.actions.credit_grant);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("owner@corvo.tech")).toBeTruthy();
    expect(within(rows[0]).getByText("reason a")).toBeTruthy();
    expect(within(rows[0]).getByText(tu.success)).toBeTruthy();
    expect(rows[0].querySelector('a[href="/app/admin/users/u-1"]')).not.toBeNull();
    expect(within(rows[1]).getByText(tu.actions.user_viewed)).toBeTruthy();
    expect(within(rows[1]).getByText(tu.failure)).toBeTruthy();
    expect(screen.queryByRole("button", { name: messages.Admin.common.loadMore })).toBeNull();
  });

  it("loads more by cursor and appends", async () => {
    mocks.audit
      .mockResolvedValueOnce({ items: [ev("a")], hasMore: true, nextCursor: "cur-1" })
      .mockResolvedValueOnce({ items: [ev("b", { reason: "second page" })], hasMore: false, nextCursor: null });
    renderPage(<AuditPage />);
    fireEvent.click(await screen.findByRole("button", { name: messages.Admin.common.loadMore }));
    await screen.findAllByText("second page");
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cur-1" }));
    expect(screen.getAllByText("reason a").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: messages.Admin.common.loadMore })).toBeNull();
  });

  it("clears the error alert after a successful retry of load more", async () => {
    mocks.audit
      .mockResolvedValueOnce({ items: [ev("a")], hasMore: true, nextCursor: "cur-1" })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ items: [ev("b", { reason: "second page" })], hasMore: false, nextCursor: null });
    renderPage(<AuditPage />);
    const button = await screen.findByRole("button", { name: messages.Admin.common.loadMore });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.common.loadMore }));
    await screen.findAllByText("second page");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the empty state", async () => {
    mocks.audit.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    renderPage(<AuditPage />);
    expect(await screen.findByText(messages.Admin.common.empty)).toBeTruthy();
  });
});
