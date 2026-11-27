// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanyDetailPage from "@/app/(dashboard)/app/companies/[id]/page";
import messages from "@/messages/en.json";

const state = vi.hoisted(() => ({ permissions: new Set<string>(), company: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "c1" }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => state.permissions.has(permission), fiscalEnvironment: "test" }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  companies: { get: async () => state.company },
  certificates: { list: async () => ({ items: [], hasMore: false, nextCursor: null }) },
  collectAll: async () => [],
}));
vi.mock("@/lib/use-scroll-to-hash", () => ({ useScrollToHash: () => undefined }));
vi.mock("@/components/companies/nfe-settings-form", () => ({ NfeSettingsForm: ({ canManage }: { canManage: boolean }) => <div>nfe-section manage={String(canManage)}</div> }));
vi.mock("@/components/dashboard/company-form", () => ({ CompanyForm: () => null }));
vi.mock("@/components/companies/dps-sequence-card", () => ({ DpsSequenceCard: () => null }));
vi.mock("@/components/companies/accountant-package-card", () => ({ AccountantPackageCard: () => null }));
vi.mock("@/components/dashboard/certificate-upload", () => ({ CertificateUpload: () => null }));
vi.mock("@/components/dashboard/company-fiscal-guide", () => ({ CompanyFiscalGuide: () => null }));
vi.mock("@/components/dashboard/company-fiscal-setup", () => ({ CompanyFiscalSetup: () => null }));
vi.mock("@/components/companies/municipality-agreement-notice", () => ({ MunicipalityAgreementNotice: () => null }));

const renderPage = async () => {
  render(<NextIntlClientProvider locale="en" messages={messages}><CompanyDetailPage /></NextIntlClientProvider>);
  await screen.findByText("Acme Ltda");
};

beforeEach(() => {
  state.permissions = new Set(["nfse.companies.view", "nfe.documents.view", "nfe.documents.manage"]);
  state.company = { id: "c1", legalName: "Acme Ltda", tradeName: "Acme", taxId: "11222333000181", status: "ready", environment: "test", municipalityCode: "3550308", address: { city: "São Paulo", state: "SP" }, taxRegime: "simples", municipalReg: "", defaultServiceCode: "", setupGaps: [] };
});
afterEach(cleanup);

describe("NF-e section of the company page", () => {
  it("shows the NF-e section for every account whose member may view it", async () => {
    await renderPage();
    expect(screen.getByText("nfe-section manage=true")).toBeTruthy();
  });

  it("passes the manage permission down so a viewer only reads", async () => {
    state.permissions = new Set(["nfse.companies.view", "nfe.documents.view"]);
    await renderPage();
    expect(screen.getByText("nfe-section manage=false")).toBeTruthy();
  });

  it("hides the section from a member without nfe.documents.view", async () => {
    state.permissions = new Set(["nfse.companies.view"]);
    await renderPage();
    expect(screen.queryByText(/nfe-section/)).toBeNull();
  });
});
