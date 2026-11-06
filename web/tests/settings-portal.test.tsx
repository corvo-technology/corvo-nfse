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
  cancelPix: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  canManage: true,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  billing: { plan: mocks.plan, portal: mocks.portal, cancelPix: mocks.cancelPix },
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

  it("a Pix-only account (active plan, no Stripe customer) gets no card block and no portal button", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: false, pixSubscription: { status: "active", planSlug: "equipe", brCode: null, paymentLinkUrl: null } }));
    renderPage();
    await screen.findByTestId("pix-settings");
    expect(screen.queryByTestId("card-settings")).toBeNull();
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

  it("no Pix block when there is no Pix contract", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: true }));
    renderPage();
    await waitFor(() => expect(portalButton()).not.toBeNull());
    expect(screen.queryByTestId("pix-settings")).toBeNull();
  });
});

describe("Settings payments: nothing to configure, permissions, errors", () => {
  it("with no card and no Pix contract the card disappears: one line points to Billing, no 'you have not paid' filler", async () => {
    mocks.plan.mockResolvedValue(account());
    renderPage();
    expect((await screen.findByRole("link", { name: "Open Billing" })).getAttribute("href")).toBe("/app/billing");
    expect(screen.getByText("Payments and their history live in Billing.")).toBeTruthy();
    expect(screen.queryByTestId("card-settings")).toBeNull();
    expect(screen.queryByTestId("pix-settings")).toBeNull();
    expect(document.body.textContent).not.toMatch(/have not paid/);
    expect(screen.queryByTestId("payment-row")).toBeNull();
  });

  it("the payment history is no longer on this screen", async () => {
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: true }));
    renderPage();
    await waitFor(() => expect(portalButton()).not.toBeNull());
    expect(screen.queryByText("History")).toBeNull();
    expect(screen.queryByRole("link", { name: "See plan and invoices" })).toBeNull();
  });

  it("without billing permission: no action buttons, and the reason", async () => {
    mocks.canManage = false;
    mocks.plan.mockResolvedValue(account({ status: "active", stripePortalAvailable: true, pixSubscription: { status: "active", planSlug: "equipe", brCode: null, paymentLinkUrl: null } }));
    renderPage();
    await screen.findByText("Only members with billing permission can manage payments.");
    expect(portalButton()).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
  });

  it("a failed load says so instead of showing an empty, misleading screen", async () => {
    mocks.plan.mockRejectedValue(new ApiError(500, "boom"));
    renderPage();
    await screen.findByText("Could not load your payments.");
  });

  it("the delete-workspace section stays as it was", async () => {
    mocks.plan.mockResolvedValue(account());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Delete workspace" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
