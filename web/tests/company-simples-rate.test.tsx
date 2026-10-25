// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanySimplesRate } from "@/components/dashboard/company-simples-rate";
import messages from "@/messages/en.json";
import type { Company } from "@/lib/types";

const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), manage: true, month: "2026-10" }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  companies: { simplesRates: mocks.list, saveSimplesRate: mocks.save },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ fiscalEnvironment: "test", can: (permission: string) => permission === "nfse.companies.view" || (permission === "nfse.companies.manage" && mocks.manage) }),
}));
vi.mock("@/lib/company-fiscal", async (original) => ({ ...(await original<typeof import("@/lib/company-fiscal")>()), fiscalMonth: () => mocks.month }));

const company = { id: "company-1", tenantId: "tenant-1", taxRegime: "Simples Nacional" } as Company;
const rate = (month: string, totalRate: string, issRate: string | null = null) => ({ companyId: "company-1", month, totalRate, issRate, ibsRate: null, cbsRate: null, updatedAt: "2026-10-01T00:00:00Z" });
const renderCard = () => render(<NextIntlClientProvider locale="en" messages={messages}><CompanySimplesRate company={company} /></NextIntlClientProvider>);

beforeEach(() => { vi.clearAllMocks(); mocks.manage = true; mocks.month = "2026-10"; });
afterEach(cleanup);

describe("Simples Nacional monthly rate", () => {
  it("shows the rate in force and no warning when it is up to date", async () => {
    mocks.list.mockResolvedValue([rate("2026-10", "6.54", "2.00")]);
    renderCard();
    expect(await screen.findByText("6.54%")).toBeTruthy();
    expect(screen.queryByText(/but the current month is/i)).toBeNull();
  });

  it("warns when the latest informed month is more than one month old", async () => {
    mocks.list.mockResolvedValue([rate("2026-07", "5.10")]);
    renderCard();
    expect(await screen.findByText(/last informed rate is from 2026-07/i)).toBeTruthy();
  });

  it("asks for the first rate when none was informed", async () => {
    mocks.list.mockResolvedValue([]);
    renderCard();
    expect(await screen.findByText(/no rate informed yet/i)).toBeTruthy();
  });

  it("saves the month with the typed rates and reloads", async () => {
    mocks.list.mockResolvedValue([]);
    mocks.save.mockResolvedValue(rate("2026-10", "6.54", "2.00"));
    renderCard();
    fireEvent.change(await screen.findByLabelText(/total rate/i), { target: { value: "6.54" } });
    fireEvent.change(screen.getByLabelText(/ISS rate/i), { target: { value: "2.00" } });
    fireEvent.click(screen.getByRole("button", { name: /save rate/i }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("company-1", "2026-10", { totalRate: "6.54", issRate: "2.00" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("refuses an invalid percentage without calling the API", async () => {
    mocks.list.mockResolvedValue([]);
    renderCard();
    fireEvent.change(await screen.findByLabelText(/total rate/i), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: /save rate/i }));
    expect(await screen.findByText(/between 0 and 100/i)).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("hides the form without the manage permission", async () => {
    mocks.manage = false;
    mocks.list.mockResolvedValue([rate("2026-10", "6.54")]);
    renderCard();
    await screen.findByText("6.54%");
    expect(screen.queryByRole("button", { name: /save rate/i })).toBeNull();
  });
});
