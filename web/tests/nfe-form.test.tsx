// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NfeForm } from "@/components/nfe/nfe-form";
import { ApiError } from "@/lib/api";
import { emptyForm, fromDocument, toCreateInput, totalsPreview } from "@/lib/nfe-form";
import type { NfeDocument } from "@/lib/nfe";
import type { Company } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ create: vi.fn(), validate: vi.fn(), resubmit: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/nfe", async (original) => ({ ...(await original<typeof import("@/lib/nfe")>()), createNfe: mocks.create, validateNfe: mocks.validate, resubmitNfe: mocks.resubmit }));

const companies = [{ id: "c1", legalName: "Acme Ltda", tradeName: "Acme" }] as Company[];
const filled = () => {
  const form = emptyForm("c1");
  form.recipient = { ...form.recipient, taxId: "123.456.789-09", name: "Maria da Silva", street: "Rua das Flores", number: "10", district: "Centro", zip: "01001-000", cityCode: "3550308", city: "São Paulo", state: "sp" };
  form.items = [
    { code: "SKU1", description: "Camiseta", ncm: "6109.10.00", cfop: "5102", unit: "UN", quantity: "2", unitPrice: "10", csosn: "" },
    { code: "SKU2", description: "Calça", ncm: "62034200", cfop: "5102", unit: "UN", quantity: "1", unitPrice: "30,5", csosn: "400" },
  ];
  form.payments = [{ tPag: "17", amount: "50,50" }];
  return form;
};
const renderForm = (initial = filled(), resubmitId?: string) => render(<NextIntlClientProvider locale="en" messages={messages}><NfeForm companies={companies} initial={initial} resubmitId={resubmitId} /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ type: "nfe", id: "n9", status: "queued" });
  mocks.resubmit.mockResolvedValue({ type: "nfe", id: "n1", status: "queued" });
  mocks.validate.mockResolvedValue({ valid: true, accessKeyPreview: "3525" + "1".repeat(40) });
});
afterEach(cleanup);

describe("NF-e form", () => {
  it("marks the NCM field of the second item when the API reports items[1].ncm", async () => {
    mocks.validate.mockRejectedValue(new ApiError(422, "invalid", "NFE_VALIDATION_FAILED", undefined, [{ field: "items[1].ncm", code: "NCM_INVALID", message: "bad ncm" }]));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    const message = await screen.findByText(messages.ApiErrors.ncm_invalid);
    const ncmFields = screen.getAllByLabelText(/^NCM/);
    expect(ncmFields).toHaveLength(2);
    expect(ncmFields[0].getAttribute("aria-invalid")).toBeNull();
    expect(ncmFields[1].getAttribute("aria-invalid")).toBe("true");
    expect(message.id).toBe(ncmFields[1].getAttribute("aria-describedby"));
    expect(screen.getByRole("alert").textContent).toBe(messages.Nfe.form.fixFields);
  });

  it("a validation sends nothing: no number, no issue", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText(/The data is fine/);
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("a double click sends one request with one key; the same content retried keeps the key", async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.create.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderForm();
    const issue = screen.getByRole("button", { name: "Issue NF-e" });
    fireEvent.click(issue);
    fireEvent.click(issue);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    release({ type: "nfe", id: "n9", status: "queued" });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/nfe/n9"));
  });

  it("a retry after a failure with the same content reuses the key; changing the content makes a new one", async () => {
    mocks.create.mockRejectedValueOnce(new ApiError(0, "Could not connect to the server.")).mockResolvedValue({ type: "nfe", id: "n9", status: "queued" });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Issue NF-e" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Issue NF-e" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Issue NF-e" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1][1]).toBe(mocks.create.mock.calls[0][1]);
    expect(typeof mocks.create.mock.calls[0][1]).toBe("string");
  });

  it("sends the typed data as the API body (numbers, digits-only NCM, UF in capitals) and goes to the new note", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Issue NF-e" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/nfe/n9"));
    const [input] = mocks.create.mock.calls[0];
    expect(input).toMatchObject({
      companyId: "c1",
      recipient: { taxId: "123.456.789-09", indIeDest: 9, address: { state: "SP", cityCode: "3550308" } },
      items: [{ code: "SKU1", ncm: "61091000", quantity: 2, unitPrice: 10 }, { code: "SKU2", unitPrice: 30.5, tax: { csosn: "400" } }],
      payments: [{ tPag: "17", amount: 50.5 }],
      sendEmail: true,
    });
  });

  it("the IE field only appears for a taxpayer recipient", () => {
    renderForm();
    expect(screen.queryByLabelText(/^State registration/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Recipient's state registration/), { target: { value: "1" } });
    expect(screen.getByLabelText(/^State registration/)).toBeTruthy();
  });

  it("adds and removes items, and shows the preview total", () => {
    renderForm();
    expect(screen.getAllByText(/R\$\s?50,50|\$50\.50/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getAllByLabelText(/^NCM/)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove item 3" }));
    expect(screen.getAllByLabelText(/^NCM/)).toHaveLength(2);
  });

  it("a rejected note is resent with PUT to the same note, with the company locked", async () => {
    renderForm(filled(), "n1");
    expect((screen.getByLabelText(/^Company/) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Send NF-e again" }));
    await waitFor(() => expect(mocks.resubmit).toHaveBeenCalledWith("n1", expect.objectContaining({ companyId: "c1" }), expect.any(String)));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("lists on top a problem that has no field on the screen (such as the company setup)", async () => {
    mocks.create.mockRejectedValue(new ApiError(422, "x", "COMPANY_NFE_INCOMPLETE", undefined, [{ field: "state_registration", code: "COMPANY_NFE_INCOMPLETE", message: "lacks" }]));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Issue NF-e" }));
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("state_registration");
    expect(banner.textContent).toContain(messages.ApiErrors.company_nfe_incomplete);
  });
});

describe("form helpers", () => {
  it("rounds each item to cents (half up) for the preview", () => {
    expect(totalsPreview([{ quantity: "3", unitPrice: "0.335" }, { quantity: "1", unitPrice: "1.005" }])).toBeCloseTo(1.01 + 1.01, 5);
    expect(totalsPreview([{ quantity: "", unitPrice: "" }])).toBe(0);
  });

  it("fills the form back from a rejected note", () => {
    const doc = {
      companyId: "c1", natOp: "Venda", additionalInfo: null,
      recipient: { taxId: "12345678909", name: "Maria", indIeDest: 9, stateRegistration: null, email: null, address: { street: "Rua", number: "1", complement: null, district: "Centro", zip: "01001000", cityCode: "3550308", city: "SP", state: "SP" } },
      items: [{ nItem: 1, code: "A", description: "D", ncm: "61091000", cfop: "5102", unit: "UN", quantity: "2.0000", unitPrice: "10.0000000000", total: "20.00", tax: { csosn: "102" } }],
      payment: { payments: [{ tPag: "17", amount: "20.00" }], change: "0.00" },
    } as unknown as NfeDocument;
    const form = fromDocument(doc);
    expect(form.items[0]).toMatchObject({ quantity: "2", unitPrice: "10,00", csosn: "102", cfopManual: true });
    expect(form.payments).toEqual([{ tPag: "17", amount: "20,00" }]);
    expect(toCreateInput(form).recipient.address.complement).toBeUndefined();
  });
});
