// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/(dashboard)/app/settings/page";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  portal: vi.fn(),
  payments: vi.fn(),
  cancelPix: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  canManage: true,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  billing: { plan: mocks.plan, portal: mocks.portal, payments: mocks.payments, cancelPix: mocks.cancelPix },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => permission === "billing.manage" && mocks.canManage }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toastError, success: mocks.toastSuccess }) }));

const assign = vi.fn();
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><SettingsPage /></NextIntlClientProvider>);
const account = (sub: Record<string, unknown> = {}) => ({ subscription: { status: "none", stripePortalAvailable: false, pixSubscription: null, paidUntil: null, ...sub } });
const portalButton = () => screen.queryByRole("button", { name: "Open Stripe portal" }) as HTMLButtonElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canManage = true;
  mocks.payments.mockResolvedValue([]);
  Object.defineProperty(window, "location", { configurable: true, value: { assign } });
});
afterEach(cleanup);

describe("Settings payments: card", () => {
  it("opens the Stripe portal only for an account that has a Stripe customer", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: true }));
    mocks.portal.mockResolvedValue({ url: "https://billing.stripe.com/session/test" });
    renderPage();
    await waitFor(() => expect(portalButton()).not.toBeNull());
    fireEvent.click(portalButton()!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/session/test"));
  });

  it("a Pix-only account (active plan, no Stripe customer) gets no portal button, and a clear sentence", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: false }));
    renderPage();
    await screen.findByText("You have not paid by card yet.");
    expect(portalButton()).toBeNull();
    expect(mocks.portal).not.toHaveBeenCalled();
  });

  it("shows a toast and keeps the button usable when the API refuses the portal", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: true }));
    mocks.portal.mockRejectedValue(new ApiError(409, "Subscribe before managing billing"));
    renderPage();
    await waitFor(() => expect(portalButton()).not.toBeNull());
    fireEvent.click(portalButton()!);
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(assign).not.toHaveBeenCalled();
    await waitFor(() => expect(portalButton()!.disabled).toBe(false));
  });
});

describe("Settings payments: Pix", () => {
  const pixBlock = () => screen.getByTestId("pix-settings");

  it("Pix Automático waiting for authorization: says so, links to the QR in Billing and can be cancelled", async () => {
    mocks.plan.mockResolvedValue(account({ pixSubscription: { status: "pending", planSlug: "equipe", brCode: "000201", paymentLinkUrl: "https://w/p" } }));
    mocks.cancelPix.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("Pix Automático is waiting for your authorization in the bank app.");
    expect(within(pixBlock()).getByRole("link", { name: "View QR code in Billing" }).getAttribute("href")).toBe("/app/billing");
    fireEvent.click(within(pixBlock()).getByRole("button", { name: "Cancel authorization" }));
    await waitFor(() => expect(mocks.cancelPix).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.plan).toHaveBeenCalledTimes(2));
  });

  it("Pix Automático active: says it charges every month and can be cancelled", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active", pixSubscription: { status: "active", planSlug: "equipe", brCode: null, paymentLinkUrl: null } }));
    renderPage();
    await screen.findByText("Pix Automático is active: the plan is charged every month.");
    expect(within(pixBlock()).getByRole("button", { name: "Cancel Pix Automático" })).toBeTruthy();
    expect(within(pixBlock()).queryByRole("link", { name: "View QR code in Billing" })).toBeNull();
  });

  it("paid by Pix without a contract: explains there is no automatic charge", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active" }));
    mocks.payments.mockResolvedValue([{ id: "p1", kind: "avulso", planSlug: null, cycle: null, units: 20, amountCents: 1980, provider: "woovi", paidAt: "2026-11-05T22:28:48Z" }]);
    renderPage();
    await screen.findByText("Your Pix payments are one-off, with no automatic charge.");
  });

  it("never paid by Pix: says so, with no cancel button", async () => {
    mocks.plan.mockResolvedValue(account());
    renderPage();
    await screen.findByText("You have not paid by Pix yet.");
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
  });
});

describe("Settings payments: history and permissions", () => {
  it("lists what was paid: what, how, when and how much", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: true }));
    mocks.payments.mockResolvedValue([
      { id: "p1", kind: "avulso", planSlug: null, cycle: null, units: 20, amountCents: 1980, provider: "woovi", paidAt: "2026-11-05T22:28:48Z" },
      { id: "p2", kind: "plan", planSlug: "equipe", cycle: "annual", units: null, amountCents: 100680, provider: "stripe", paidAt: "2026-11-03T12:00:00Z" },
    ]);
    renderPage();
    const rows = await screen.findAllByTestId("payment-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("20 single invoices");
    expect(rows[0].textContent).toContain("Pix");
    expect(rows[0].textContent).toContain("R$ 19,80");
    expect(rows[0].textContent).toContain("11/05/2026");
    expect(rows[1].textContent).toContain("Equipe plan, annual");
    expect(rows[1].textContent).toContain("Card");
    expect(rows[1].textContent).toContain("R$ 1.006,80");
  });

  it("empty history says so", async () => {
    mocks.plan.mockResolvedValue(account());
    renderPage();
    await screen.findByText("No payments yet.");
  });

  it("without billing permission: no action buttons, the reason, but the history still shows", async () => {
    mocks.canManage = false;
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: true, pixSubscription: { status: "active", planSlug: "equipe", brCode: null, paymentLinkUrl: null } }));
    mocks.payments.mockResolvedValue([{ id: "p1", kind: "avulso", planSlug: null, cycle: null, units: 3, amountCents: 297, provider: "woovi", paidAt: "2026-11-05T22:28:48Z" }]);
    renderPage();
    await screen.findByText("Only members with billing permission can manage payments.");
    expect(portalButton()).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
    expect(await screen.findAllByTestId("payment-row")).toHaveLength(1);
  });

  it("always offers the way back to the plan and invoices", async () => {
    mocks.plan.mockResolvedValue(account());
    renderPage();
    expect((await screen.findByRole("link", { name: "See plan and invoices" })).getAttribute("href")).toBe("/app/billing");
  });

  it("a failed load says so instead of showing an empty, misleading screen", async () => {
    mocks.plan.mockRejectedValue(new ApiError(500, "boom"));
    mocks.payments.mockRejectedValue(new ApiError(500, "boom"));
    renderPage();
    await screen.findByText("Could not load your payments.");
  });
});
