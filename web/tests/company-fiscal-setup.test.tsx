// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyFiscalSetup } from "@/components/dashboard/company-fiscal-setup";
import { CompanyForm } from "@/components/dashboard/company-form";
import type { Company, CompanyFiscalProfile, CompanyServiceTaxProfile } from "@/lib/types";
import messages from "@/messages/en.json";
const api = vi.hoisted(() => ({ fiscalProfiles: vi.fn(), serviceTaxProfiles: vi.fn(), approveFiscalProfile: vi.fn(), approveServiceTaxProfile: vi.fn(), createServiceTaxProfile: vi.fn(), updateServiceTaxProfile: vi.fn(), saveFiscalProfile: vi.fn(), canManage: true }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ fiscalEnvironment: "live", can: (permission: string) => permission !== "nfse.certificates.manage" && (permission !== "nfse.companies.manage" || api.canManage) }) }));
vi.mock("@/lib/api", async original => {
  const actual = await original<typeof import("@/lib/api")>();
  // The Receita lookup is down here: the wizard falls back to typing the company by hand.
  return { ...actual, cnpj: { lookup: () => Promise.reject(new actual.ApiError(503, "down", "CNPJ_LOOKUP_UNAVAILABLE")) }, companies: api };
});
const company: Company = { id: "company", tenantId: "tenant", legalName: "Test Company", taxId: "11222333000181", municipalityCode: "3550308", municipalReg: "12345", taxRegime: "MEI", simpleNational: true, environment: "live", status: "ready", setupGaps: [], address: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const profile: CompanyFiscalProfile = { id: "profile", companyId: company.id, tenantId: company.tenantId, taxRegime: "MEI", simpleNational: true, specialTaxRegime: null, ibsCbsRegularOption: false, ibsCbsRegularFrom: null, validFrom: "2026-01-01", validUntil: null, source: "company_api", reviewStatus: "unreviewed", reviewedBy: null, reviewedAt: null, createdAt: "2026-01-01" };
const service: CompanyServiceTaxProfile = { id: "service", tenantId: "tenant", companyId: "company", name: "Haircut", serviceCode: "060101", municipalServiceCode: null, nbsCode: null, cst: null, classCode: null, operationIndicator: null, operationNature: "SERVICE", regimeApplicability: [], incidenceMunicipalityCode: null, issTaxation: null, issRate: null, issWithholdingDefault: false, withholdingPolicy: "UNKNOWN", withholdingRates: {}, effectiveFrom: "2026-01-01", effectiveUntil: null, classificationSource: "manual", reviewStatus: "unreviewed", catalogVersion: null, createdAt: "2026-01-01" };
const renderUI = (element: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>);
beforeEach(() => { vi.clearAllMocks(); api.canManage = true; api.fiscalProfiles.mockResolvedValue([profile]); api.serviceTaxProfiles.mockResolvedValue([]); });
afterEach(cleanup);
describe("CompanyFiscalSetup", () => {
  it("requires an explicit review before approving a saved fiscal profile", async () => {
    api.approveFiscalProfile.mockResolvedValue({ ...profile, reviewStatus: "approved" });
    renderUI(<CompanyFiscalSetup company={company} />);
    await screen.findByText("Fiscal profile awaiting review");
    expect(screen.queryByText("Ready to issue")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review fiscal profile" }));
    const confirm = screen.getByRole("button", { name: "Approve fiscal profile" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I reviewed the displayed fiscal data." }));
    api.fiscalProfiles.mockResolvedValue([{ ...profile, reviewStatus: "approved" }]);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.approveFiscalProfile).toHaveBeenCalledWith(company.id, profile.id));
    await screen.findByText("Fiscal profile approved");
  });
  it("shows fetch failures and retries instead of reporting completion", async () => {
    api.fiscalProfiles.mockRejectedValueOnce(new Error("Connection failed"));
    renderUI(<CompanyFiscalSetup company={company} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Fiscal profile approved")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Fiscal profile awaiting review");
  });
  it("does not offer mutations to a read-only user", async () => {
    api.canManage = false;
    renderUI(<CompanyFiscalSetup company={company} />);
    await screen.findByText("Fiscal profile awaiting review");
    expect(screen.queryByRole("button", { name: "Review fiscal profile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add service" })).toBeNull();
  });
  it("approves services only after an explicit confirmation of the saved classification", async () => {
    api.serviceTaxProfiles.mockResolvedValue([service]);
    api.approveServiceTaxProfile.mockResolvedValue({ ...service, reviewStatus: "approved" });
    renderUI(<CompanyFiscalSetup company={company} />);
    await screen.findAllByText("Haircut");
    fireEvent.click(screen.getByRole("button", { name: "Review service Haircut" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I reviewed the displayed fiscal data." }));
    fireEvent.click(screen.getByRole("button", { name: "Approve service" }));
    await waitFor(() => expect(api.approveServiceTaxProfile).toHaveBeenCalledWith(company.id, service.id));
  });
  it("creates the company in one call without a fiscal review step", async () => {
    const onSave = vi.fn().mockResolvedValue(company);
    renderUI(<CompanyForm onSave={onSave} onCancel={vi.fn()} onFinish={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: company.taxId } });
    await screen.findByText(/Receita lookup is down/);
    fireEvent.change(screen.getByLabelText(/Legal name/i), { target: { value: company.legalName } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText(/IBGE/i), { target: { value: "3550308" } });
    fireEvent.change(screen.getByLabelText(/Municipal registration/i), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: "MEI" } });
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ taxRegime: "MEI", simpleNational: true });
    expect(screen.queryByText("Fiscal profile awaiting review")).toBeNull();
    expect(api.approveFiscalProfile).not.toHaveBeenCalled();
  });
});
