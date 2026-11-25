// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceWebhookDeliveries } from "@/components/invoices/invoice-webhook-deliveries";
import type { WebhookDelivery } from "@/lib/types";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

const mocks = vi.hoisted(() => ({ deliveries: vi.fn(), retry: vi.fn(), permissions: new Set<string>() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => mocks.permissions.has(permission), fiscalEnvironment: "live" }) }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), webhooks: { deliveries: mocks.deliveries, retryDelivery: mocks.retry } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.permissions = new Set(); });

const delivery = (over: Partial<WebhookDelivery>): WebhookDelivery => ({
  id: "d1", tenantId: "t1", webhookConfigId: "w1", invoiceId: "inv-1", eventType: "nfse.invoice.authorized", environment: "live", url: "https://x.test/hook",
  status: "sent", statusCode: 200, retryCount: 0, createdAt: new Date().toISOString(), ...over,
});
const page = (items: WebhookDelivery[]) => ({ items, hasMore: false, nextCursor: null });
const show = (messages = en) => render(<NextIntlClientProvider locale="en" messages={messages}><InvoiceWebhookDeliveries invoiceId="inv-1" /></NextIntlClientProvider>);

describe("InvoiceWebhookDeliveries", () => {
  it("asks only for this invoice, up to 30 days, in the environment being viewed", async () => {
    mocks.permissions = new Set(["webhooks.view"]);
    mocks.deliveries.mockResolvedValue(page([]));
    show();
    expect(await screen.findByText(en.InvoiceWebhooks.empty)).toBeTruthy();
    expect(mocks.deliveries).toHaveBeenCalledWith(expect.objectContaining({ invoice_id: "inv-1", hours: 720, environment: "live" }));
  });

  it("lists the event, status, answer code and attempts in plain words", async () => {
    mocks.permissions = new Set(["webhooks.view"]);
    mocks.deliveries.mockResolvedValue(page([delivery({ status: "failed", statusCode: 500, retryCount: 5 })]));
    show();
    expect(await screen.findByText(en.Webhooks.events.nfse.invoice.authorized.label)).toBeTruthy();
    expect(screen.getByText(en.Webhooks.deliveryStatus.failed)).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("shows the texts in Portuguese too", async () => {
    mocks.permissions = new Set(["webhooks.view"]);
    mocks.deliveries.mockResolvedValue(page([delivery({ status: "sent" })]));
    show(pt as unknown as typeof en);
    expect(await screen.findByText(pt.Webhooks.deliveryStatus.sent)).toBeTruthy();
    expect(screen.getByText(pt.InvoiceWebhooks.title)).toBeTruthy();
  });

  it("resends a failed notice and reloads the list", async () => {
    mocks.permissions = new Set(["webhooks.view", "webhooks.manage"]);
    mocks.deliveries.mockResolvedValue(page([delivery({ status: "failed", statusCode: 500 })]));
    mocks.retry.mockResolvedValue({ retried: true });
    show();
    fireEvent.click(await screen.findByRole("button", { name: en.InvoiceWebhooks.retry }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText(en.InvoiceWebhooks.retried)).toBeTruthy();
    expect(mocks.deliveries).toHaveBeenCalledTimes(2);
  });

  it("offers no resend for a delivered notice or without permission to manage", async () => {
    mocks.permissions = new Set(["webhooks.view", "webhooks.manage"]);
    mocks.deliveries.mockResolvedValue(page([delivery({ status: "sent" })]));
    show();
    await screen.findByText(en.Webhooks.deliveryStatus.sent);
    expect(screen.queryByRole("button", { name: en.InvoiceWebhooks.retry })).toBeNull();
    cleanup();
    mocks.permissions = new Set(["webhooks.view"]);
    mocks.deliveries.mockResolvedValue(page([delivery({ status: "failed" })]));
    show();
    await screen.findByText(en.Webhooks.deliveryStatus.failed);
    expect(screen.queryByRole("button", { name: en.InvoiceWebhooks.retry })).toBeNull();
  });

  it("shows nothing and asks nothing without permission to see webhooks", () => {
    const { container } = show();
    expect(container.textContent).toBe("");
    expect(mocks.deliveries).not.toHaveBeenCalled();
  });

  it("says when the notices could not be loaded", async () => {
    mocks.permissions = new Set(["webhooks.view"]);
    mocks.deliveries.mockRejectedValue(new Error("boom"));
    show();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
