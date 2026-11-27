// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NfceForm } from "@/components/nfe/nfce-form";
import { ApiError } from "@/lib/api";
import { deliveryProblems, emptyNfceForm, toNfceInput } from "@/lib/nfce-form";
import type { Company } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ create: vi.fn(), validate: vi.fn(), resubmit: vi.fn(), push: vi.fn(), settings: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/nfe", async (original) => ({
  ...(await original<typeof import("@/lib/nfe")>()),
  createNfce: mocks.create, validateNfce: mocks.validate, resubmitNfe: mocks.resubmit, getNfeSettings: mocks.settings,
}));

const companies = [{ id: "c1", legalName: "Acme Ltda", tradeName: "Acme" }] as Company[];
const filled = () => {
  const form = emptyNfceForm("c1");
  form.items = [{ code: "SKU1", description: "Cafe", ncm: "09012100", cfop: "5102", unit: "UN", quantity: "2", unitPrice: "10", csosn: "" }];
  form.payments = [{ tPag: "17", amount: "20,00", cardBrand: "", cardAuth: "", cardCnpj: "" }];
  return form;
};
const renderForm = (initial = filled(), resubmitId?: string) => render(<NextIntlClientProvider locale="en" messages={messages}><NfceForm companies={companies} initial={initial} resubmitId={resubmitId} /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ defaultCsosn: "102", defaultSeries: 1 });
  mocks.create.mockResolvedValue({ type: "nfce", id: "n9", status: "queued" });
  mocks.resubmit.mockResolvedValue({ type: "nfce", id: "n1", status: "queued" });
  mocks.validate.mockResolvedValue({ valid: true, accessKeyPreview: "3525" + "1".repeat(40) });
});
afterEach(cleanup);

describe("toNfceInput", () => {
  it("an anonymous sale in person sends no recipient, no indPres and no e-mail request", () => {
    const input = toNfceInput(filled());
    expect(input.recipient).toBeUndefined();
    expect(input.indPres).toBeUndefined();
    expect(input.sendEmail).toBe(false);
    expect(input.payments).toEqual([{ tPag: "17", amount: 20 }]);
    expect(input.items[0]).toMatchObject({ ncm: "09012100", quantity: 2, unitPrice: 10 });
  });

  it("only the CPF is enough; digits only", () => {
    const form = filled();
    form.consumer.taxId = "123.456.789-09";
    expect(toNfceInput(form).recipient).toEqual({ taxId: "12345678909" });
  });

  it("card data goes with the payment; a brand alone is not integrated", () => {
    const form = filled();
    form.payments = [{ tPag: "03", amount: "20,00", cardBrand: "01", cardAuth: "", cardCnpj: "" }];
    expect(toNfceInput(form).payments[0].card).toEqual({ tpIntegra: 2, tBand: "01" });
    form.payments = [{ tPag: "03", amount: "20,00", cardBrand: "01", cardAuth: "A1", cardCnpj: "12.345.678/0001-95" }];
    expect(toNfceInput(form).payments[0].card).toEqual({ tpIntegra: 1, cnpj: "12345678000195", tBand: "01", cAut: "A1" });
    form.payments = [{ tPag: "01", amount: "20,00", cardBrand: "01", cardAuth: "", cardCnpj: "" }];
    expect(toNfceInput(form).payments[0].card).toBeUndefined();
  });

  it("delivery (indPres 4) sends the address and asks locally for what is missing", () => {
    const form = filled();
    form.indPres = "4";
    expect(Object.keys(deliveryProblems(form))).toEqual(expect.arrayContaining(["recipient.taxId", "recipient.name", "recipient.address.street", "recipient.address.cityCode"]));
    form.consumer = { taxId: "12345678909", name: "Maria", email: "" };
    form.address = { street: "Rua A", number: "1", complement: "", district: "Centro", zip: "01001-000", cityCode: "3550308", city: "Sao Paulo", state: "sp" };
    expect(deliveryProblems(form)).toEqual({});
    const input = toNfceInput(form);
    expect(input.indPres).toBe(4);
    expect(input.recipient?.address).toMatchObject({ street: "Rua A", state: "SP" });
  });
});

describe("NfceForm", () => {
  it("issues the sale without a consumer: no recipient is sent", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Issue NFC-e" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const [input, key] = mocks.create.mock.calls[0];
    expect(input.recipient).toBeUndefined();
    expect(typeof key).toBe("string");
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/nfe/n9"));
  });

  it("delivery sale without address stops before sending and marks the fields", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("How was the sale made?"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue NFC-e" }));
    await screen.findByText("For a delivery sale, fill in the consumer CPF or CNPJ, name and address.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Street/).getAttribute("aria-invalid")).toBe("true");
  });

  it("a validation sends nothing", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText(/The data is fine/);
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("shows the translated reason of the API (consumer id above the limit)", async () => {
    mocks.create.mockRejectedValue(new ApiError(422, "x", "VALIDATION", undefined, [{ field: "recipient.taxId", code: "NFCE_CONSUMER_ID_REQUIRED", message: "id required" }]));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Issue NFC-e" }));
    await screen.findByText(messages.ApiErrors.nfce_consumer_id_required);
  });

  it("card fields appear only for credit, debit and Pix", async () => {
    const form = filled();
    form.payments = [{ tPag: "01", amount: "20,00", cardBrand: "", cardAuth: "", cardCnpj: "" }];
    renderForm(form);
    expect(screen.queryByLabelText(/^Card brand/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "03" } });
    expect(screen.getByLabelText(/^Card brand/)).toBeTruthy();
  });

  it("resubmits to the same note", async () => {
    renderForm(filled(), "n1");
    fireEvent.click(screen.getByRole("button", { name: "Send NFC-e again" }));
    await waitFor(() => expect(mocks.resubmit).toHaveBeenCalledTimes(1));
    expect(mocks.resubmit.mock.calls[0][0]).toBe("n1");
  });

  it("says there is no correction letter and the cancellation window", () => {
    renderForm();
    expect(screen.getByRole("note").textContent).toMatch(/30 minutes/);
  });
});
