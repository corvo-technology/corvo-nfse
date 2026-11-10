// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyForm } from "@/components/dashboard/company-form";
import NewInvoicePage from "@/app/(dashboard)/app/invoices/new/page";
import { ApiError } from "@/lib/api";
import { companySetup } from "@/lib/company-setup";
import type { Company } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ environment: "test" as "test" | "live", list: vi.fn(), create: vi.fn(), schedule: vi.fn(), push: vi.fn(), findCustomer: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => false, fiscalEnvironment: mocks.environment }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, back: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), companies: { list: mocks.list }, invoices: { create: mocks.create }, schedules: { create: mocks.schedule }, customers: { find: mocks.findCustomer } }));

const company: Company = {
  id: "company-1", tenantId: "tenant-1", legalName: "Example LTDA", taxId: "11222333000181", taxRegime: "Simples Nacional", simpleNational: true, simplesRate: "6.54",
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
  mocks.environment = "test"; mocks.list.mockReset(); mocks.create.mockReset(); mocks.schedule.mockReset(); mocks.push.mockReset(); mocks.findCustomer.mockReset(); mocks.findCustomer.mockResolvedValue(null);
  mocks.list.mockResolvedValue({ items: [company], hasMore: false, nextCursor: null }); mocks.create.mockResolvedValue({ id: "invoice-1" }); mocks.schedule.mockResolvedValue({ id: "schedule-1" });
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
  it("asks a Simples Nacional company for its rate and sends it", async () => {
    const onSave = vi.fn().mockResolvedValue(company);
    renderUI(<CompanyForm onSave={onSave} onCancel={vi.fn()} />); reachFiscal();
    fill("IBGE", "3550308"); fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: "Simples Nacional" } });
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    expect(screen.getByText("Enter the effective Simples rate.")).toBeTruthy(); expect(onSave).not.toHaveBeenCalled();
    fill("Effective Simples rate", "6,54"); fill("ISS rate", "2.01");
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({ simplesRate: "6.54", simplesIssRate: "2.01" });
  });
  it("does not show the rate fields for a MEI", () => {
    renderUI(<CompanyForm onSave={vi.fn()} onCancel={vi.fn()} />); reachFiscal();
    fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: "MEI" } });
    expect(screen.queryByLabelText(/Effective Simples rate/i)).toBeNull();
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
  it("issues for a customer abroad: its own fields replace the CPF/CNPJ and the Brazilian address", async () => {
    mocks.create.mockResolvedValue({ id: "inv-9" });
    renderUI(<NewInvoicePage />);
    await waitFor(() => expect(screen.getByRole("option", { name: company.legalName })).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.foreign.toggle) }));
    expect(screen.queryByLabelText(/CPF or CNPJ/i)).toBeNull();
    fill("Name /", "Acme Inc."); fill("Service description", "Software development"); fill("Total amount", "19900");
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.sendEmail.label) }));
    expect((screen.getByRole("button", { name: messages.Invoices.submit }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(new RegExp(`^${messages.Invoices.foreign.country}`)), { target: { value: "US" } });
    fill("Tax id \\(NIF\\)", "12-3456789"); fill("Street", "1 Market St"); fill("Number", "100"); fill("District or neighbourhood", "SoMa"); fill("City", "San Francisco"); fill("State, province or region", "CA"); fill("Postal code", "94105");
    fireEvent.click(screen.getByRole("button", { name: messages.Invoices.submit }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const sent = mocks.create.mock.calls[0][0];
    expect(sent.customer).toEqual({ name: "Acme Inc.", email: undefined, foreign: { taxId: "12-3456789", country: "US", postalCode: "94105", city: "San Francisco", region: "CA", street: "1 Market St", number: "100", district: "SoMa" } });
  });
  it("sends the reason instead of a tax id when the customer abroad has none", async () => {
    mocks.create.mockResolvedValue({ id: "inv-9" });
    renderUI(<NewInvoicePage />);
    await waitFor(() => expect(screen.getByRole("option", { name: company.legalName })).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.foreign.toggle) }));
    fill("Name /", "Acme Inc."); fill("Service description", "Software development"); fill("Total amount", "19900");
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.sendEmail.label) }));
    fireEvent.change(screen.getByLabelText(new RegExp(`^${messages.Invoices.foreign.country}`)), { target: { value: "DE" } });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${messages.Invoices.foreign.noTaxId}`)), { target: { value: "not_required" } });
    fill("Street", "Unter den Linden"); fill("Number", "1"); fill("District or neighbourhood", "Mitte"); fill("City", "Berlin"); fill("State, province or region", "BE"); fill("Postal code", "10117");
    fireEvent.click(screen.getByRole("button", { name: messages.Invoices.submit }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0].customer.foreign).toEqual({ noTaxIdReason: "not_required", country: "DE", postalCode: "10117", city: "Berlin", region: "BE", street: "Unter den Linden", number: "1", district: "Mitte" });
  });
  it("fills the name and the email of a customer saved from an earlier invoice, once the document is complete", async () => {
    mocks.findCustomer.mockResolvedValue({ taxId: "52998224725", name: "Maria da Silva", email: "maria@example.com", lastUsedAt: "", createdAt: "", updatedAt: "" });
    renderUI(<NewInvoicePage />);
    await waitFor(() => expect(screen.getByRole("option", { name: company.legalName })).toBeTruthy());
    fill("CPF or CNPJ", "5299822472");
    expect(mocks.findCustomer).not.toHaveBeenCalled();
    fill("CPF or CNPJ", "52998224725");
    await waitFor(() => expect(field("Name /").value).toBe("Maria da Silva"));
    expect(mocks.findCustomer).toHaveBeenCalledWith("52998224725", expect.anything());
    expect(field("Billing email").value).toBe("maria@example.com");
    expect(screen.getByText(messages.Invoices.hints.savedCustomer)).toBeTruthy();
  });
  it("never replaces a name the person already typed", async () => {
    mocks.findCustomer.mockResolvedValue({ taxId: "52998224725", name: "Maria da Silva", email: null, lastUsedAt: "", createdAt: "", updatedAt: "" });
    renderUI(<NewInvoicePage />);
    await waitFor(() => expect(screen.getByRole("option", { name: company.legalName })).toBeTruthy());
    fill("Name /", "Maria S. Souza"); fill("CPF or CNPJ", "52998224725");
    await waitFor(() => expect(mocks.findCustomer).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(field("Name /").value).toBe("Maria S. Souza");
  });
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
  it("sends the declared ISS base deduction and lists it in the summary", async () => {
    await prepareInvoice(); fill("Deduction from the ISS base", "8000");
    expect(screen.getByText(messages.Invoices.summary.deduction)).toBeTruthy();
    const issue = screen.getByRole("button", { name: "Issue NFS-e" }) as HTMLButtonElement; expect(issue.disabled).toBe(false);
    fireEvent.click(issue); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ amount: 199, deduction: 80 });
  });
  it("issues the first note now and creates the recurrence from the next period", async () => {
    await prepareInvoice(); fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.repeat.label) }));
    fireEvent.change(screen.getByLabelText(messages.Invoices.repeat.frequency), { target: { value: "WEEKLY" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" })); await waitFor(() => expect(mocks.schedule).toHaveBeenCalledOnce());
    const [body, key] = mocks.schedule.mock.calls[0];
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(key).toBe(`${mocks.create.mock.calls[0][1]}:recurrence`);
    expect(body).toMatchObject({ companyId: company.id, amount: 199, options: { type: "RECURRING", recurrence: { frequency: "WEEKLY" } } });
    expect(body.competenceDate > new Date().toLocaleDateString("sv-SE")).toBe(true);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/invoices/invoice-1"));
  });
  it("explains a missing Simples rate in the user's language and links to the company, never the API's English", async () => {
    mocks.create.mockRejectedValueOnce(new ApiError(422, "Request validation failed", "ERROR_VALIDATION", undefined, [{ field: "simplesRate", code: "ERROR_SIMPLES_RATE_REQUIRED", message: "The company's Simples Nacional rate is required to issue (set simplesRate with PATCH /companies/x)" }]));
    await prepareInvoice(); fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(messages.ApiErrors.simples_rate_required);
    expect(alert.textContent).not.toContain("PATCH");
    expect(within(alert).getByRole("link", { name: messages.Invoices.fields.openCompany }).getAttribute("href")).toBe(`/app/companies/${company.id}`);
  });
  it("shows the translated text of a top-level error that has no field", async () => {
    mocks.create.mockRejectedValueOnce(new ApiError(402, "Insufficient credits", "ERROR_INSUFFICIENT_CREDITS"));
    await prepareInvoice(); fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" }));
    expect((await screen.findByRole("alert")).textContent).toContain(messages.ApiErrors.insufficient_credits);
  });
  it("does not create a recurrence unless asked", async () => {
    await prepareInvoice(); fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" })); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("says the note was issued when only the recurrence fails, and retries without a second note", async () => {
    mocks.schedule.mockRejectedValueOnce(new Error("boom"));
    await prepareInvoice(); fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.repeat.label) }));
    fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(messages.Invoices.repeat.createdButFailed.slice(0, 30)));
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Issue NFS-e" })); await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.create.mock.calls[1][1]).toBe(mocks.create.mock.calls[0][1]);
    expect(mocks.schedule.mock.calls[1][1]).toBe(mocks.schedule.mock.calls[0][1]);
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

describe("CNPJ of an existing company", () => {
  it("is read-only on edit and is not sent", async () => {
    const onSave = vi.fn().mockResolvedValue(company);
    renderUI(<CompanyForm company={company} onSave={onSave} onCancel={vi.fn()} />);
    expect(field("CNPJ").readOnly).toBe(true);
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("taxId");
  });
});
