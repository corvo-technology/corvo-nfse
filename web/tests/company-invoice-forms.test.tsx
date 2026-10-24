// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyForm } from "@/components/dashboard/company-form";
import NewInvoicePage from "@/app/app/invoices/new/page";
import { companySetup } from "@/lib/company-setup";
import type { Company } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ environment: "test" as "test" | "live", list: vi.fn(), create: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => false, fiscalEnvironment: mocks.environment }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, back: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), companies: { list: mocks.list }, invoices: { create: mocks.create } }));

const company: Company = {
  id: "company-1", tenantId: "tenant-1", legalName: "Example LTDA", taxId: "11222333000181", taxRegime: "Simples Nacional", simpleNational: true,
  environment: "test", status: "ready", address: {}, municipalityCode: "3550308", defaultServiceCode: "010101", setupGaps: [],
  createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z",
};
const renderUI = (children: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>);
const field = (label: string) => screen.getByLabelText(new RegExp(label, "i")) as HTMLInputElement;
const fill = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save company" }));
function chooseService(code: string) {
  fireEvent.focus(screen.getByRole("combobox", { name: /Default service code|Tax code/i }));
  fireEvent.change(screen.getByRole("combobox", { name: /Default service code|Tax code/i }), { target: { value: code } });
  fireEvent.mouseDown(screen.getByRole("option", { name: new RegExp(code) }));
}
function reachFiscal() {
  fill("Legal name", company.legalName); fill("CNPJ", company.taxId);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
async function prepareInvoice() {
  renderUI(<NewInvoicePage />);
  await waitFor(() => expect(screen.getByRole("option", { name: company.legalName })).toBeTruthy());
  fill("CPF or CNPJ", "52998224725"); fill("Name /", "Test customer"); fill("Service description", "Software development"); fill("Total amount", "19900");
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.sendEmail.label) }));
}
beforeEach(() => {
  mocks.environment = "test"; mocks.list.mockReset(); mocks.create.mockReset(); mocks.push.mockReset();
  mocks.list.mockResolvedValue({ items: [company], hasMore: false, nextCursor: null }); mocks.create.mockResolvedValue({ id: "invoice-1" });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("Company fiscal setup", () => {
  it("requires a seven-digit municipality in test mode and submits the chosen default service", async () => {
    const onSave = vi.fn().mockResolvedValue(company);
    renderUI(<CompanyForm onSave={onSave} onCancel={vi.fn()} />); reachFiscal();
    expect(field("IBGE").required).toBe(true); expect(field("Municipal registration").required).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    expect(screen.getByText("Enter an IBGE municipality code with exactly 7 digits.")).toBeTruthy(); expect(onSave).not.toHaveBeenCalled();
    fill("IBGE", "3550308"); chooseService("010101"); fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: "MEI" } });
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({ taxId: company.taxId, municipalityCode: "3550308", defaultServiceCode: "010101" });
    expect(onSave.mock.calls[0][0].municipalReg).toBeUndefined();
  });
  it("lets a live company be created without a municipal registration", async () => {
    mocks.environment = "live"; const onSave = vi.fn();
    renderUI(<CompanyForm onSave={onSave} onCancel={vi.fn()} />); reachFiscal(); fill("IBGE", "3550308");
    expect(field("Municipal registration").required).toBe(false);
    fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: "MEI" } }); fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].municipalReg).toBeUndefined();
  });
  it("keeps the municipal registration off the invoice unless the user opts in", async () => {
    const onSave = vi.fn().mockResolvedValue(company);
    renderUI(<CompanyForm onSave={onSave} onCancel={vi.fn()} />); reachFiscal(); fill("IBGE", "3550308");
    const optIn = () => screen.queryByRole("checkbox", { name: /Send the municipal registration/ }) as HTMLInputElement | null;
    expect(optIn()).toBeNull();
    fill("Municipal registration", "12345");
    expect(optIn()?.checked).toBe(false);
    fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: "MEI" } }); fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({ municipalReg: "12345", sendMunicipalReg: false });
  });
  it("sends the municipal registration only after ticking the option", async () => {
    const onSave = vi.fn().mockResolvedValue(company);
    renderUI(<CompanyForm onSave={onSave} onCancel={vi.fn()} />); reachFiscal(); fill("IBGE", "3550308"); fill("Municipal registration", "12345");
    fireEvent.click(screen.getByRole("checkbox", { name: /Send the municipal registration/ }));
    fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: "MEI" } }); fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({ municipalReg: "12345", sendMunicipalReg: true });
  });
  it("shows the saved service code in edit mode and sends null to clear it", async () => {
    const onSave = vi.fn().mockResolvedValue(company);
    renderUI(<CompanyForm company={company} onSave={onSave} onCancel={vi.fn()} />);
    expect((screen.getByRole("combobox", { name: /Default service code|Tax code/i }) as HTMLInputElement).value).toContain("010101");
    fireEvent.click(screen.getByRole("button", { name: "Clear selected code" }));
    expect(screen.queryByRole("listbox")).toBeNull(); save();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce()); expect(onSave.mock.calls[0][0].defaultServiceCode).toBeNull();
  });
  it("changes the default service without clearing other fiscal data", async () => {
    const onSave = vi.fn().mockResolvedValue(company);
    renderUI(<CompanyForm company={company} onSave={onSave} onCancel={vi.fn()} />); chooseService("010201"); save();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce()); expect(onSave.mock.calls[0][0]).toMatchObject({ defaultServiceCode: "010201", municipalityCode: "3550308" });
  });
  it("reports a legacy missing municipality as an issuance requirement", () => {
    const setup = companySetup({ ...company, municipalityCode: undefined, setupGaps: ["municipality_code"] });
    expect(setup.items.find((item) => item.key === "municipalityCode")).toEqual({ key: "municipalityCode", done: false, blocking: true });
  });
});

describe("Invoice company defaults", () => {
  it("uses the paginated company list, sends its CNPJ and omits inherited service values", async () => {
    await prepareInvoice();
    expect(screen.getByText(/Company default: 010101/)).toBeTruthy(); expect(screen.getByRole("combobox", { name: /Default service code|Tax code/i })).toBeTruthy();
    expect(field("Service location IBGE").required).toBe(false);
    const submit = screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement; expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    const payload = JSON.parse(JSON.stringify(mocks.create.mock.calls[0][0]));
    expect(payload.companyTaxId).toBe(company.taxId); expect(payload).not.toHaveProperty("companyId");
    expect(payload.service).toEqual({ description: "Software development" }); expect(mocks.push).toHaveBeenCalledWith("/app/invoices/invoice-1");
  });
  it("supports explicit per-invoice service and location overrides", async () => {
    await prepareInvoice(); chooseService("010201"); fill("Service location IBGE", "3304557");
    fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce()); expect(mocks.create.mock.calls[0][0].service).toMatchObject({ code: "010201", municipalityCode: "3304557" });
  });
  it("falls back to LC 116 item 10.09 (100901) when the company has no default service code", async () => {
    mocks.list.mockResolvedValue({ items: [{ ...company, defaultServiceCode: undefined }], hasMore: false, nextCursor: null });
    await prepareInvoice();
    expect(screen.getByText(/we use 100901/)).toBeTruthy();
    const issue = screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement; expect(issue.disabled).toBe(false);
    fireEvent.click(issue); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0].service.code).toBeUndefined();
  });
  it("issues without tomador when no customer data is filled, and without a description", async () => {
    renderUI(<NewInvoicePage />);
    await waitFor(() => expect(screen.getByRole("option", { name: company.legalName })).toBeTruthy());
    fill("Total amount", "19900"); fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.sendEmail.label) }));
    const issue = screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement; expect(issue.disabled).toBe(false);
    fireEvent.click(issue); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    const payload = JSON.parse(JSON.stringify(mocks.create.mock.calls[0][0]));
    expect(payload).not.toHaveProperty("customer"); expect(payload.service).toEqual({});
  });
  it("sends the deduction declared for a salon partnership and lists it in the summary", async () => {
    await prepareInvoice(); fill("Deduction from the ISS base", "8000");
    expect(screen.getByText(messages.Invoices.summary.deduction)).toBeTruthy();
    const issue = screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement; expect(issue.disabled).toBe(false);
    fireEvent.click(issue); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ amount: 199, deduction: 80 });
  });
  it("omits the deduction when the field is empty", async () => {
    await prepareInvoice();
    expect(screen.queryByText(messages.Invoices.summary.deduction)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" })); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(JSON.parse(JSON.stringify(mocks.create.mock.calls[0][0]))).not.toHaveProperty("deduction");
  });
  it("blocks issuing while the deduction is not less than the total amount", async () => {
    await prepareInvoice(); fill("Deduction from the ISS base", "19900");
    expect(screen.getByText(messages.Invoices.fields.invalidDeduction)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement).disabled).toBe(true);
    fill("Deduction from the ISS base", "19899");
    expect((screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("needs a valid CPF or CNPJ as soon as any customer data is filled", async () => {
    renderUI(<NewInvoicePage />);
    await waitFor(() => expect(screen.getByRole("option", { name: company.legalName })).toBeTruthy());
    fill("Total amount", "19900"); fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.sendEmail.label) })); fill("Name /", "Only a name");
    expect((screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement).disabled).toBe(true);
    fill("CPF or CNPJ", "52998224725");
    expect((screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("does not let an override conceal a missing issuer municipality", async () => {
    mocks.list.mockResolvedValue({ items: [{ ...company, municipalityCode: undefined, setupGaps: ["municipality_code"] }], hasMore: false, nextCursor: null });
    await prepareInvoice(); fill("Service location IBGE", "3304557");
    expect((screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement).disabled).toBe(true); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("loads more companies by cursor and resets overrides when changing issuer", async () => {
    mocks.list.mockResolvedValueOnce({ items: [company], hasMore: true, nextCursor: "company-next" }).mockResolvedValueOnce({ items: [{ ...company, id: "company-2", legalName: "Second company", taxId: "41834687000148", municipalityCode: "3304557", defaultServiceCode: "010201" }], hasMore: false, nextCursor: null });
    await prepareInvoice(); chooseService("010601"); fill("Service location IBGE", "3550308");
    fireEvent.click(screen.getByRole("button", { name: "Load more companies" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Second company" })).toBeTruthy());
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 100, cursor: "company-next" });
    fireEvent.change(field("Issuing company"), { target: { value: "company-2" } });
    expect((screen.getByRole("combobox", { name: /Default service code|Tax code/i }) as HTMLInputElement).value).toBe(""); expect(field("Service location IBGE").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce()); expect(mocks.create.mock.calls[0][0].companyTaxId).toBe("41834687000148");
  });
});
