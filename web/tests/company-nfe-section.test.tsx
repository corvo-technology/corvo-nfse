// @vitest-environment jsdom
import { useEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanyDetailPage from "@/app/(dashboard)/app/companies/[id]/page";
import messages from "@/messages/en.json";

const state = vi.hoisted(() => ({ permissions: new Set<string>(), company: {} as Record<string, unknown>, ie: null as string | null }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "c1" }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => state.permissions.has(permission), fiscalEnvironment: "test" }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  companies: { get: async () => state.company },
  certificates: { list: async () => ({ items: [], hasMore: false, nextCursor: null }) },
  collectAll: async () => [],
}));
vi.mock("@/lib/use-scroll-to-hash", () => ({ useScrollToHash: () => undefined }));
vi.mock("@/components/companies/nfe-settings-form", () => ({
  NfeSettingsForm: ({ canManage, onSettings }: { canManage: boolean; onSettings?: (value: { stateRegistration: string | null }) => void }) => {
    useEffect(() => { onSettings?.({ stateRegistration: state.ie }); }, [onSettings]);
    return <div>nfe-section manage={String(canManage)}</div>;
  },
}));
vi.mock("@/components/dashboard/company-form", () => ({ CompanyForm: () => null }));
vi.mock("@/components/companies/dps-sequence-card", () => ({ DpsSequenceCard: () => null }));
vi.mock("@/components/companies/accountant-package-card", () => ({ AccountantPackageCard: () => null }));
vi.mock("@/components/dashboard/certificate-upload", () => ({ CertificateUpload: () => null }));
vi.mock("@/components/dashboard/company-fiscal-guide", () => ({ CompanyFiscalGuide: () => null }));
vi.mock("@/components/dashboard/company-fiscal-setup", () => ({ CompanyFiscalSetup: () => <div>fiscal-setup</div> }));
vi.mock("@/components/companies/municipality-agreement-notice", () => ({ MunicipalityAgreementNotice: () => null }));

const renderPage = async () => {
  render(<NextIntlClientProvider locale="en" messages={messages}><CompanyDetailPage /></NextIntlClientProvider>);
  await screen.findByText("Acme Ltda");
};

beforeEach(() => {
  state.ie = null;
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

  it("shows the state registration (IE) in the summary card, or a dash when there is none", async () => {
    state.ie = "110042490114";
    await renderPage();
    await screen.findByText("110042490114");
    expect(screen.getByText("State registration (IE)", { selector: ".eyebrow" })).toBeTruthy();
    cleanup();
    state.ie = null;
    await renderPage();
    expect(screen.getByTestId("company-ie").textContent).toBe("—");
  });

  it("does not show the IE to a member who cannot view NF-e", async () => {
    state.permissions = new Set(["nfse.companies.view"]);
    await renderPage();
    expect(screen.queryByTestId("company-ie")).toBeNull();
  });

  it("puts the NF-e section after the fiscal setup and the certificate, before the DPS and accountant cards", async () => {
    state.permissions = new Set(["nfse.companies.view", "nfse.certificates.view", "nfe.documents.view"]);
    await renderPage();
    const order = (node: Node) => Array.from(document.body.querySelectorAll("*")).indexOf(node as Element);
    const fiscal = order(screen.getByText("fiscal-setup"));
    const certificate = order(document.getElementById("certificado")!);
    const nfe = order(screen.getByText(/nfe-section/));
    expect(fiscal).toBeLessThan(certificate);
    expect(certificate).toBeLessThan(nfe);
  });
});
