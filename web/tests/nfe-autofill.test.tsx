// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NfeForm } from "@/components/nfe/nfe-form";
import { emptyForm, ieExample, lineTotal, maskNcm, suggestedCfop, toCreateInput, toNumber } from "@/lib/nfe-form";
import { LOCAL_PRODUCTS_KEY } from "@/lib/nfe-products";
import type { Company } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), find: vi.fn(), cnpj: vi.fn(), cep: vi.fn(), settings: vi.fn(), products: vi.fn(), saveProduct: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
const auth = vi.hoisted(() => ({ env: "test" as "test" | "live", nfeProduction: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ fiscalEnvironment: auth.env, features: { nfeProduction: auth.nfeProduction } }) }));
beforeEach(() => { auth.env = "test"; auth.nfeProduction = false; });
vi.mock("@/lib/nfe", async (original) => ({ ...(await original<typeof import("@/lib/nfe")>()), createNfe: mocks.create, getNfeSettings: mocks.settings }));
vi.mock("@/lib/api", async (original) => {
  const api = await original<typeof import("@/lib/api")>();
  return { ...api, customers: { ...api.customers, find: mocks.find }, cnpj: { lookup: mocks.cnpj }, productFavorites: { ...api.productFavorites, list: mocks.products, save: mocks.saveProduct } };
});
vi.mock("@/lib/viacep", () => ({ lookupCep: mocks.cep }));

const CPF = "12345678909";
const CNPJ = "11222333000181";
const companies = [{ id: "c1", legalName: "Acme Ltda", tradeName: "Acme", address: { state: "SP" } }] as Company[];
const renderForm = (initial = emptyForm("c1")) => render(<NextIntlClientProvider locale="en" messages={messages}><NfeForm companies={companies} initial={initial} /></NextIntlClientProvider>);
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const value = (label: RegExp | string) => (screen.getByLabelText(label) as HTMLInputElement).value;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.find.mockResolvedValue(null);
  mocks.cnpj.mockRejectedValue(new Error("no lookup"));
  mocks.cep.mockResolvedValue(null);
  mocks.products.mockResolvedValue([]);
  mocks.settings.mockResolvedValue({ defaultNatOp: "Venda de mercadoria", defaultCsosn: "400" });
});
afterEach(cleanup);

describe("recipient autofill", () => {
  it("fills the name and e-mail of a saved customer found by CPF, and masks the CPF", async () => {
    mocks.find.mockResolvedValue({ taxId: CPF, name: "Maria da Silva", email: "maria@example.com" });
    renderForm();
    type(/^CPF or CNPJ/, CPF);
    expect(value(/^CPF or CNPJ/)).toBe("123.456.789-09");
    await waitFor(() => expect(value(/^Name/)).toBe("Maria da Silva"));
    expect(value(/^Email|^E-mail/)).toBe("maria@example.com");
    expect(mocks.cnpj).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("saved customer");
  });

  it("a CNPJ fills the name and the address from the public registry", async () => {
    mocks.cnpj.mockResolvedValue({ legalName: "Loja Azul Ltda", tradeName: "", address: { zip: "01001000", street: "Praça da Sé", number: "10", complement: "", district: "Sé", city: "São Paulo", state: "SP" }, municipalityCode: "3550308" });
    renderForm();
    type(/^CPF or CNPJ/, CNPJ);
    expect(value(/^CPF or CNPJ/)).toBe("11.222.333/0001-81");
    await waitFor(() => expect(value(/^Name/)).toBe("Loja Azul Ltda"));
    expect(value(/^Street/)).toBe("Praça da Sé");
    expect(value(/^ZIP/)).toBe("01001-000");
    expect(value(/^State/)).toBe("SP");
    // The IBGE code is known, so it is not asked: it shows with a way to change it.
    expect(screen.queryByLabelText(/IBGE/)).toBeNull();
    expect(screen.getByText(/3550308/)).toBeTruthy();
    expect(value(/Recipient's state registration/)).toBe("9");
  });

  it("does not overwrite what the person already typed", async () => {
    mocks.cnpj.mockResolvedValue({ legalName: "Loja Azul Ltda", tradeName: "", address: { zip: "", street: "Rua A", number: "", complement: "", district: "", city: "", state: "" }, municipalityCode: null });
    renderForm();
    type(/^Name/, "Meu nome");
    type(/^CPF or CNPJ/, CNPJ);
    await waitFor(() => expect(value(/^Street/)).toBe("Rua A"));
    expect(value(/^Name/)).toBe("Meu nome");
  });

  it("a valid CEP fills street, district, city, state and the IBGE code, which can still be changed", async () => {
    mocks.cep.mockResolvedValue({ street: "Praça da Sé", district: "Sé", city: "São Paulo", state: "SP", ibge: "3550308" });
    renderForm();
    type(/^ZIP/, "01001000");
    expect(value(/^ZIP/)).toBe("01001-000");
    await waitFor(() => expect(value(/^Street/)).toBe("Praça da Sé"));
    expect(value(/^District/)).toBe("Sé");
    expect(value(/^City/)).toBe("São Paulo");
    expect(mocks.cep).toHaveBeenCalledWith("01001000", expect.anything());
    expect(screen.queryByLabelText(/IBGE/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "change" }));
    expect(value(/IBGE/)).toBe("3550308");
  });

  it("asks for the IBGE code when it could not be found", () => {
    renderForm();
    expect(screen.getByLabelText(/IBGE/)).toBeTruthy();
  });

  it("shows placeholders on the recipient and item fields", () => {
    renderForm();
    expect((screen.getByLabelText(/^CPF or CNPJ/) as HTMLInputElement).placeholder).toContain("000.000.000-00");
    expect((screen.getByLabelText(/^ZIP/) as HTMLInputElement).placeholder).toBe("01001-000");
    expect((screen.getByLabelText(/^NCM/) as HTMLInputElement).placeholder).toBe("e.g. 6109.10.00");
    expect((screen.getByLabelText(/^Unit price/) as HTMLInputElement).placeholder).toBe("0,00");
  });
});

describe("items and payment", () => {
  it("suggests 5102 inside the state and 6102 for another one, until the person types the CFOP", async () => {
    renderForm();
    type(/^State/, "sp");
    await waitFor(() => expect(value(/^CFOP/)).toBe("5102"));
    type(/^State/, "rj");
    await waitFor(() => expect(value(/^CFOP/)).toBe("6102"));
    type(/^CFOP/, "6108");
    type(/^State/, "SP");
    expect(value(/^CFOP/)).toBe("6108");
  });

  it("the payment follows the total of the items until it is typed, and the change only exists for cash", () => {
    renderForm();
    type(/^Unit price/, "1050");
    expect(value(/^Unit price/)).toBe("10,50");
    expect(value(/^Amount paid/)).toBe("10,50");
    expect(screen.getAllByText(/Item total/).length).toBeGreaterThan(0);
    type(/^Quantity/, "3");
    expect(value(/^Amount paid/)).toBe("31,50");
    expect(screen.queryByLabelText(/^Change/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Payment method/), { target: { value: "01" } });
    expect(screen.getByLabelText(/^Change/)).toBeTruthy();
    type(/^Amount paid/, "5000");
    type(/^Unit price/, "2000");
    expect(value(/^Amount paid/)).toBe("50,00");
  });

  it("warns only when the payment and the total differ", () => {
    renderForm();
    type(/^Unit price/, "1000");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Payment matches the total/)).toBeTruthy();
    type(/^Amount paid/, "500");
    expect(screen.getByRole("alert").textContent).toContain("different from the note total");
  });

  it("an item with no code, unit and a masked price is sent with ITEM-1, UN and the number", async () => {
    mocks.create.mockResolvedValue({ type: "nfe", id: "n9", status: "queued" });
    const form = emptyForm("c1");
    form.items = [{ ...form.items[0], description: "Camiseta", ncm: "61091000", unit: "", unitPrice: "1.234,50" }];
    form.payments = [{ tPag: "17", amount: "1.234,50" }];
    const input = toCreateInput(form);
    expect(input.items[0]).toMatchObject({ code: "ITEM-1", unit: "UN", unitPrice: 1234.5 });
    expect(input.payments[0].amount).toBe(1234.5);
  });

  it("shows the CSOSN and nature of operation the company already has", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByText("Company default (400)")).toBeTruthy());
    expect((screen.getByLabelText(/^Nature of the operation/) as HTMLInputElement).placeholder).toBe("Venda de mercadoria");
  });

  const camiseta = { id: "p1", companyId: "c1", description: "Camiseta", code: "CAM-1", gtin: null, ncm: "61091000", cest: null, cfop: "5102", unit: "UN", unitPrice: 10, csosn: null, origin: null, createdAt: "2026-11-01T00:00:00Z" };

  it("a saved product is searched by name or code and fills the item", async () => {
    mocks.products.mockResolvedValue([camiseta, { ...camiseta, id: "p2", description: "Calça", code: "CAL-2" }]);
    renderForm();
    const search = await screen.findByLabelText("Search a saved product (name or code)");
    fireEvent.change(search, { target: { value: "cal-2" } });
    expect(screen.queryByRole("option", { name: /Camiseta/ })).toBeNull();
    fireEvent.change(search, { target: { value: "camis" } });
    act(() => { fireEvent.mouseDown(screen.getByRole("option", { name: /Camiseta/ })); });
    expect(value(/^Description/)).toBe("Camiseta");
    expect(value(/^NCM/)).toBe("6109.10.00");
    expect(value(/^Unit price/)).toBe("10,00");
  });

  it("saves an item as a product of the company", async () => {
    mocks.saveProduct.mockResolvedValue(camiseta);
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save as product" }));
    expect(await screen.findByText(/fill in the description and the 8-digit NCM/)).toBeTruthy();
    expect(mocks.saveProduct).not.toHaveBeenCalled();
    type(/^Description/, "Camiseta");
    type(/^NCM/, "61091000");
    type(/^Unit price/, "10,00");
    fireEvent.click(screen.getByRole("button", { name: "Save as product" }));
    await waitFor(() => expect(mocks.saveProduct).toHaveBeenCalledWith("c1", expect.objectContaining({ description: "Camiseta", ncm: "61091000", unitPrice: 10, unit: "UN", cfop: "5102" })));
    expect(await screen.findByText(/Product saved/)).toBeTruthy();
  });

  it("moves the old list kept in the browser to the server once, then stops using it", async () => {
    localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify([
      { code: "", description: "Nova", ncm: "61091000", cfop: "5102", unit: "UN", unitPrice: "5,00", csosn: "" },
      { code: "", description: "Sem NCM", ncm: "", cfop: "5102", unit: "UN", unitPrice: "1,00", csosn: "" },
      { code: "X", description: "Velha", ncm: "62034200", cfop: "5102", unit: "UN", unitPrice: "20,50", csosn: "102" },
    ]));
    mocks.saveProduct.mockResolvedValue(camiseta);
    renderForm();
    await waitFor(() => expect(localStorage.getItem(LOCAL_PRODUCTS_KEY)).toBeNull());
    // The oldest goes first and a product without a valid NCM is left out.
    expect(mocks.saveProduct.mock.calls.map((call) => (call[1] as { description: string }).description)).toEqual(["Velha", "Nova"]);
    expect(mocks.saveProduct).toHaveBeenCalledWith("c1", expect.objectContaining({ description: "Velha", unitPrice: 20.5, csosn: "102" }));
    expect(mocks.products).toHaveBeenCalledWith("c1", expect.anything());
  });

  it("keeps the old list in the browser when the server does not take it", async () => {
    localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify([{ code: "", description: "Nova", ncm: "61091000", cfop: "5102", unit: "UN", unitPrice: "5,00", csosn: "" }]));
    mocks.saveProduct.mockRejectedValue(new Error("down"));
    renderForm();
    await waitFor(() => expect(mocks.saveProduct).toHaveBeenCalled());
    expect(localStorage.getItem(LOCAL_PRODUCTS_KEY)).not.toBeNull();
  });

  it("a saved customer fills the address, the IBGE code and the state registration", async () => {
    mocks.find.mockResolvedValue({ taxId: CNPJ, name: "Loja Azul Ltda", email: null, indIeDest: 1, stateRegistration: "111222333444", address: { street: "Av. Paulista", number: "1000", complement: null, district: "Bela Vista", zip: "01310100", cityCode: "3550308", city: "São Paulo", state: "SP" } });
    renderForm();
    type(/^CPF or CNPJ/, CNPJ);
    await waitFor(() => expect(value(/^Street/)).toBe("Av. Paulista"));
    expect(value(/^ZIP/)).toBe("01310-100");
    expect(value(/^District/)).toBe("Bela Vista");
    expect(screen.getByText(/3550308/)).toBeTruthy();
    expect(value(/^Recipient's state registration/)).toBe("1");
    expect(value(/^State registration/)).toBe("111222333444");
  });
});

describe("helpers", () => {
  it("masks the NCM, reads the BRL mask and suggests the CFOP", () => {
    expect(maskNcm("61091000")).toBe("6109.10.00");
    expect(maskNcm("6109")).toBe("6109");
    expect(toNumber("1.234,56")).toBe(1234.56);
    expect(toNumber("10.5")).toBe(10.5);
    expect(suggestedCfop("SP", "sp")).toBe("5102");
    expect(suggestedCfop("SP", "RJ")).toBe("6102");
    expect(suggestedCfop(undefined, "RJ")).toBe("");
    expect(lineTotal({ quantity: "3", unitPrice: "0,335" })).toBe(1.01);
    expect(ieExample("sp")).toBe("110.042.490.114");
    expect(ieExample("ZZ")).toBe("110042490114");
  });
});
