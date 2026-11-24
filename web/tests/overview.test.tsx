// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "@/app/(dashboard)/app/page";
import { InvoiceHeatmap } from "@/components/dashboard/invoice-heatmap";
import { invoices, billing } from "@/lib/api";
import type { InvoiceOverview, OverviewPeriod } from "@/lib/api";
import messages from "@/messages/en.json";
import { invoice } from "./fixtures";

const auth = vi.hoisted(() => ({ tenantId: "tenant-a", fiscalEnvironment: "test", permissions: ["nfse.invoices.view", "billing.view", "nfse.invoices.issue"] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ ...auth, can: (permission: string) => auth.permissions.includes(permission) }) }));
vi.mock("@/lib/api", () => ({ invoices: { overview: vi.fn() }, billing: { plan: vi.fn() } }));
vi.mock("@/components/dashboard/getting-started-banner", () => ({ GettingStartedBanner: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const overview = (period: OverviewPeriod = "7d", count = 1201): InvoiceOverview => ({
  period, from: "2026-10-12", to: "2026-10-18", timezone: "America/Sao_Paulo",
  counts: { authorized: count, rejected: 2, processing: 3 },
  dailyActivity: Array.from({ length: period === "7d" ? 7 : 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 19 - (period === "7d" ? 7 : 30) + i)).toISOString().slice(0, 10), count: i === 0 ? count : 0 })),
  recentInvoices: Array.from({ length: 6 }, (_, i) => ({ ...invoice, id: `invoice-${i}`, customerName: `Customer ${i}`, customerTaxId: "12345678909", serviceDescription: "Consulting" })) as InvoiceOverview["recentInvoices"],
});
const wrap = (children: React.ReactNode) => <NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>;
const renderPage = () => render(wrap(<OverviewPage />));

afterEach(cleanup);
beforeEach(() => {
  auth.tenantId = "tenant-a"; auth.fiscalEnvironment = "test";
  auth.permissions = ["nfse.invoices.view", "billing.view", "nfse.invoices.issue"];
  vi.mocked(invoices.overview).mockReset().mockImplementation(async (period) => overview(period));
  vi.mocked(billing.plan).mockReset().mockResolvedValue({ subscription: { blocked: false }, usage: { creditsUsed: 4, monthlyAllowance: 100, creditsRemaining: 90, avulsoBalance: 6 } } as Awaited<ReturnType<typeof billing.plan>>);
});

describe("overview page", () => {
  it("renders aggregated totals, caps recent invoices at five and links to all invoices", async () => {
    renderPage();
    await screen.findAllByText("1201");
    expect(invoices.overview).toHaveBeenCalledWith("7d", expect.any(AbortSignal));
    expect(screen.queryByText("Customer 5")).toBeNull();
    expect(screen.getAllByText("Customer 4").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /View all/ }).getAttribute("href")).toBe("/app/invoices");
    expect(screen.getByText("Plan + single invoices")).toBeTruthy();
  });
  it("switches periods without refetching monthly credits", async () => {
    renderPage();
    await screen.findAllByText("1201");
    fireEvent.click(screen.getByRole("button", { name: /^30 days$/ }));
    await waitFor(() => expect(invoices.overview).toHaveBeenCalledWith("30d", expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /invoices?$/ })).toHaveLength(30));
    expect(billing.plan).toHaveBeenCalledTimes(1);
  });
  it("ignores an old period response after a faster new response", async () => {
    let resolveOld!: (result: InvoiceOverview) => void;
    vi.mocked(invoices.overview).mockImplementation((period) => period === "7d" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(overview("30d", 99)));
    renderPage();
    const oldSignal = vi.mocked(invoices.overview).mock.calls[0][1]!;
    fireEvent.click(screen.getByRole("button", { name: /^30 days$/ }));
    await screen.findAllByText("99");
    resolveOld(overview("7d", 777));
    await waitFor(() => expect(oldSignal.aborted).toBe(true));
    expect(screen.queryByText("777")).toBeNull();
  });
  it("reloads for a new tenant or fiscal environment", async () => {
    const page = renderPage();
    await screen.findAllByText("1201");
    auth.fiscalEnvironment = "live";
    page.rerender(wrap(<OverviewPage />));
    await waitFor(() => expect(invoices.overview).toHaveBeenCalledTimes(2));
    auth.tenantId = "tenant-b";
    page.rerender(wrap(<OverviewPage />));
    await waitFor(() => expect(invoices.overview).toHaveBeenCalledTimes(3));
    expect(billing.plan).toHaveBeenCalledTimes(3);
  });
  it("preserves invoice data if credits fail", async () => {
    vi.mocked(billing.plan).mockRejectedValue(new Error("unavailable"));
    renderPage();
    await screen.findAllByText("1201");
    expect(screen.getByRole("alert").textContent).toContain("Could not load credits");
    expect(screen.getAllByText("Customer 0").length).toBeGreaterThan(0);
  });
  it("preserves credits if overview fails", async () => {
    vi.mocked(invoices.overview).mockRejectedValue(new Error("unavailable"));
    renderPage();
    await screen.findAllByRole("alert");
    expect(screen.getByText(/^96/, { selector: "dd" })).toBeTruthy();
    expect(screen.queryByText("1201")).toBeNull();
  });
  it("hides invoice data and skips its request without permission", async () => {
    auth.permissions = ["billing.view"];
    renderPage();
    await screen.findByText(/^96/, { selector: "dd" });
    expect(invoices.overview).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Recent invoices" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Period" })).toBeNull();
  });
  it("does not fetch or display credits without billing permission", async () => {
    auth.permissions = ["nfse.invoices.view"];
    renderPage();
    await screen.findAllByText("1201");
    expect(billing.plan).not.toHaveBeenCalled();
    expect(screen.queryByText("Plan + single invoices")).toBeNull();
  });
});

describe("daily activity calendar", () => {
  it("keeps every zero-activity day visible and readable", () => {
    const data = overview().dailyActivity.map((day) => ({ ...day, count: 0 }));
    render(wrap(<InvoiceHeatmap dailyActivity={data} locale="en" />));
    expect(screen.getAllByRole("button")).toHaveLength(7);
    expect(screen.getByText("No authorized invoices in this period")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Oct 12: 0 invoices/ })).toBeTruthy();
  });
  it("shows the same day detail on keyboard focus and touch/click", () => {
    render(wrap(<InvoiceHeatmap dailyActivity={overview().dailyActivity} locale="en" />));
    const first = screen.getByRole("button", { name: /Oct 12: 1,201 invoices/ });
    fireEvent.focus(first);
    expect(screen.getByRole("status").textContent).toContain("1201");
    expect(first.getAttribute("aria-describedby")).toBe(screen.getByRole("status").id);
    fireEvent.click(screen.getByRole("button", { name: /Oct 13: 0 invoices/ }));
    expect(screen.getByRole("status").textContent).toContain("Oct 13");
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.getByRole("status").textContent).toContain("Period total");
  });
});
