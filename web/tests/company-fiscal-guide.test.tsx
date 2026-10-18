// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyFiscalGuide } from "@/components/dashboard/company-fiscal-guide";
import type { Company, CompanyFiscalProfile } from "@/lib/types";
import messages from "@/messages/en.json";

const api = vi.hoisted(() => ({ fiscalProfiles: vi.fn(), serviceTaxProfiles: vi.fn(), saveFiscalProfile: vi.fn(), approveFiscalProfile: vi.fn(), createServiceTaxProfile: vi.fn(), approveServiceTaxProfile: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ fiscalEnvironment: "live", can: () => true }) }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), companies: api }));
const company = { id: "company", tenantId: "tenant", legalName: "Test", defaultServiceCode: "010101" } as Company;
const profile = (over: Partial<CompanyFiscalProfile>): CompanyFiscalProfile => ({
  id: "profile", companyId: "company", tenantId: "tenant", taxRegime: "SIMPLES_NACIONAL", simpleNational: true, specialTaxRegime: null,
  ibsCbsRegularOption: false, ibsCbsRegularFrom: null, simplesIssRate: null, validFrom: "2020-01-01", validUntil: null, reviewStatus: "approved", ...over,
} as CompanyFiscalProfile);
const renderUI = () => render(<NextIntlClientProvider locale="en" messages={messages}><CompanyFiscalGuide company={company} /></NextIntlClientProvider>);
beforeEach(() => { vi.clearAllMocks(); api.serviceTaxProfiles.mockResolvedValue([]); });
afterEach(cleanup);

describe("CompanyFiscalGuide", () => {
  it("asks nothing about services for an approved Simples company", async () => {
    api.fiscalProfiles.mockResolvedValue([profile({})]);
    renderUI();
    await screen.findByText("Regime: Simples Nacional");
    expect(screen.getByText("Service: nothing to set up")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save and confirm service" })).toBeNull();
  });
  it("confirms an unreviewed regime with a single click", async () => {
    api.fiscalProfiles.mockResolvedValue([profile({ reviewStatus: "unreviewed" })]);
    api.approveFiscalProfile.mockResolvedValue({});
    renderUI();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm regime" }));
    await waitFor(() => expect(api.approveFiscalProfile).toHaveBeenCalledWith("company", "profile"));
  });
  it("saves the Simples ISS rate as a confirmed new version starting the day after the approved one", async () => {
    api.fiscalProfiles.mockResolvedValue([profile({ validFrom: "2020-01-01" })]);
    api.saveFiscalProfile.mockResolvedValue({});
    renderUI();
    fireEvent.change(await screen.findByLabelText("Rate (%)"), { target: { value: "2,01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(api.saveFiscalProfile).toHaveBeenCalled());
    const [, input] = api.saveFiscalProfile.mock.calls[0];
    expect(input).toMatchObject({ taxRegime: "SIMPLES_NACIONAL", simplesIssRate: "2.01", confirm: true });
  });
  it("rejects an out-of-range rate without calling the API", async () => {
    api.fiscalProfiles.mockResolvedValue([profile({})]);
    renderUI();
    fireEvent.change(await screen.findByLabelText("Rate (%)"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await screen.findByText("Enter a percentage between 0 and 100.");
    expect(api.saveFiscalProfile).not.toHaveBeenCalled();
  });
  it("creates and approves the service for a regular regime in one step", async () => {
    api.fiscalProfiles.mockResolvedValue([profile({ taxRegime: "LUCRO_PRESUMIDO", simpleNational: false })]);
    api.createServiceTaxProfile.mockResolvedValue({ id: "service" });
    api.approveServiceTaxProfile.mockResolvedValue({});
    renderUI();
    await screen.findByText("The service you provide");
    fireEvent.change(screen.getByLabelText(/ISS rate/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and confirm service" }));
    await waitFor(() => expect(api.approveServiceTaxProfile).toHaveBeenCalledWith("company", "service"));
    expect(api.createServiceTaxProfile.mock.calls[0][1]).toMatchObject({ serviceCode: "010101", issTaxation: "NORMAL", issRate: "5", withholdingPolicy: "NONE_CONFIRMED" });
  });
});
