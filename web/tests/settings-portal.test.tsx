// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/app/settings/page";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  portal: vi.fn(),
  toastError: vi.fn(),
  canManage: true,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  billing: { plan: mocks.plan, portal: mocks.portal },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => permission === "billing.manage" && mocks.canManage }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toastError, success: vi.fn() }) }));

const assign = vi.fn();
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><SettingsPage /></NextIntlClientProvider>);
const portalButton = () => screen.getByRole("button", { name: "Open Stripe portal" }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canManage = true;
  Object.defineProperty(window, "location", { configurable: true, value: { assign } });
});
afterEach(cleanup);

describe("Settings Stripe portal", () => {
  it("opens the Stripe portal for a subscribed workspace with billing permission", async () => {
    mocks.plan.mockResolvedValue({ subscription: { status: "active" } });
    mocks.portal.mockResolvedValue({ url: "https://billing.stripe.com/session/test" });
    renderPage();
    await waitFor(() => expect(portalButton().disabled).toBe(false));

    fireEvent.click(portalButton());

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/session/test"));
  });

  it("keeps the button disabled and points to Billing when there is no subscription", async () => {
    mocks.plan.mockResolvedValue({ subscription: { status: "none" } });
    renderPage();
    await screen.findByText("Subscribe to a plan in Billing to manage payments here.");
    expect(portalButton().disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Go to Billing" }).getAttribute("href")).toBe("/app/billing");
    expect(mocks.portal).not.toHaveBeenCalled();
  });

  it("explains the missing permission and does not offer the Billing link", async () => {
    mocks.canManage = false;
    mocks.plan.mockResolvedValue({ subscription: { status: "active" } });
    renderPage();
    await screen.findByText("Only members with billing permission can open the payment portal.");
    expect(portalButton().disabled).toBe(true);
    expect(screen.queryByRole("link", { name: "Go to Billing" })).toBeNull();
  });

  it("shows a toast and re-enables the button when the API refuses the portal", async () => {
    mocks.plan.mockResolvedValue({ subscription: { status: "active" } });
    mocks.portal.mockRejectedValue(new ApiError(409, "Subscribe before managing billing"));
    renderPage();
    await waitFor(() => expect(portalButton().disabled).toBe(false));

    fireEvent.click(portalButton());

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(assign).not.toHaveBeenCalled();
    await waitFor(() => expect(portalButton().disabled).toBe(false));
  });
});
