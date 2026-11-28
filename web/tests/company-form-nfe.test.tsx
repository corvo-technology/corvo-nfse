// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyForm } from "@/components/dashboard/company-form";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ update: vi.fn(), permissions: new Set<string>() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ fiscalEnvironment: "test", can: (permission: string) => mocks.permissions.has(permission) }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  cnpj: { lookup: () => Promise.resolve({ legalName: "EMPRESA EXEMPLO LTDA", tradeName: "EXEMPLO", address: { zip: "01310100", street: "RUA A", number: "1", complement: "", district: "CENTRO", city: "SAO PAULO", state: "SP" }, municipalityCode: "3550308", simples: true, mei: false, active: true, situation: "ATIVA" }) },
  companies: { list: () => Promise.resolve({ items: [], hasMore: false, nextCursor: null }) },
  billing: { plan: () => Promise.resolve({ usage: { activeCompanies: 0, maxActiveCompanies: 999999 } }) },
}));
vi.mock("@/lib/nfe", async (original) => ({ ...(await original<typeof import("@/lib/nfe")>()), updateNfeSettings: mocks.update }));
vi.mock("@/lib/viacep", () => ({ lookupCep: vi.fn() }));
vi.mock("@/components/dashboard/certificate-upload", () => ({ CertificateUpload: () => <div>certificate-upload</div> }));

const created = { id: "company-9", legalName: "EMPRESA EXEMPLO LTDA", tradeName: "EXEMPLO" };
const onSave = vi.fn();
const renderForm = () => render(<NextIntlClientProvider locale="en" messages={messages}><CompanyForm onSave={onSave} onCancel={vi.fn()} onFinish={vi.fn()} /></NextIntlClientProvider>);
const next = () => fireEvent.click(screen.getByRole("button", { name: /continue/i }));

async function reachFiscalStep() {
  renderForm();
  fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: "11222333000181" } });
  await waitFor(() => expect((screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled).toBe(false));
  next(); next();
  fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: "Simples Nacional" } });
  fireEvent.change(screen.getByLabelText(/Effective Simples rate/i), { target: { value: "6" } });
}
const create = () => fireEvent.click(screen.getByRole("button", { name: "Create company" }));
const checkbox = () => screen.getByLabelText(/Will you issue product invoices/) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(["nfse.certificates.manage", "nfe.documents.manage"]);
  onSave.mockResolvedValue(created); mocks.update.mockResolvedValue({});
});
afterEach(cleanup);

describe("creating a company: optional NF-e / NFC-e step", () => {
  it("offers the question, unchecked, with no NF-e fields until it is checked", async () => {
    await reachFiscalStep();
    expect(checkbox().checked).toBe(false);
    expect(screen.queryByLabelText(/State registration/)).toBeNull();
    fireEvent.click(checkbox());
    expect((screen.getByLabelText(/^Series/) as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText(/NFC-e series/) as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText(/Nature of the operation/) as HTMLInputElement).placeholder).toBeTruthy();
    expect((screen.getByLabelText(/CSOSN/) as HTMLSelectElement).value).toBe("102");
    expect(screen.getByText(/SEFAZ check happens after the certificate/)).toBeTruthy();
  });

  it("does not offer it to a member who cannot manage NF-e", async () => {
    mocks.permissions = new Set(["nfse.certificates.manage"]);
    await reachFiscalStep();
    expect(screen.queryByLabelText(/Will you issue product invoices/)).toBeNull();
  });

  it("without the box checked, creates only the company", async () => {
    await reachFiscalStep(); create();
    await screen.findByText("certificate-upload");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("checked with an IE: creates the company, then saves the NF-e data with the defaults", async () => {
    await reachFiscalStep();
    fireEvent.click(checkbox());
    fireEvent.change(screen.getByLabelText(/State registration/), { target: { value: "110042490114" } });
    create();
    await screen.findByText("NF-e data saved.");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith("company-9", expect.objectContaining({ stateRegistration: "110042490114", defaultSeries: 1, nfceDefaultSeries: 1, defaultNatOp: "Venda de mercadoria", defaultCsosn: "102" }));
  });

  it("if the NF-e call fails the company still exists and the person is pointed to its page", async () => {
    mocks.update.mockRejectedValue(new ApiError(422, "invalid", "STATE_REGISTRATION_INVALID"));
    await reachFiscalStep();
    fireEvent.click(checkbox());
    fireEvent.change(screen.getByLabelText(/State registration/), { target: { value: "123" } });
    create();
    await screen.findByText(/The company was created, but we could not save the NF-e data/);
    expect(screen.getByRole("link", { name: "Open the company" }).getAttribute("href")).toBe("/app/companies/company-9#nfe");
    expect(screen.getByText("certificate-upload")).toBeTruthy();
  });

  it("checked without an IE: no call, and it says to fill it in on the company page", async () => {
    await reachFiscalStep();
    fireEvent.click(checkbox()); create();
    await screen.findByText(/The state registration for NF-e is missing/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
