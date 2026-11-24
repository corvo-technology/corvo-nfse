// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "@/app/(dashboard)/app/page";
import { invoices, billing } from "@/lib/api";
import messages from "@/messages/en.json";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ tenantId: "tenant-a", fiscalEnvironment: "live", can: () => true }) }));
vi.mock("@/lib/api", () => ({ invoices: { overview: vi.fn() }, billing: { plan: vi.fn() } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/dashboard/getting-started-card", () => ({ GettingStartedCard: () => <div data-testid="getting-started" /> }));

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(invoices.overview).mockReset().mockResolvedValue({ period: "7d", from: "2026-10-12", to: "2026-10-18", timezone: "America/Sao_Paulo", counts: { authorized: 0, rejected: 0, processing: 0 }, dailyActivity: [], recentInvoices: [] } as never);
  vi.mocked(billing.plan).mockReset().mockResolvedValue({ subscription: { blocked: false }, usage: { creditsUsed: 0, monthlyAllowance: 0, creditsRemaining: 0, avulsoBalance: 0 } } as never);
});

describe("overview page getting started", () => {
  it("shows the Comece por aqui card on the dashboard", async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><OverviewPage /></NextIntlClientProvider>);
    expect(await screen.findByTestId("getting-started")).toBeTruthy();
  });
});
