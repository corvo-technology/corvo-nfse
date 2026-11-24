// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyForm } from "@/components/dashboard/company-form";
import messages from "@/messages/en.json";

// Plain function (not vi.fn): vitest would track a rejected promise and report it as unhandled.
const api = vi.hoisted(() => {
  const state = { impl: (() => Promise.resolve(null)) as (taxId: string, signal?: AbortSignal) => Promise<unknown>, calls: [] as string[] };
  return { state, lookup: (taxId: string, signal?: AbortSignal) => { state.calls.push(taxId); return state.impl(taxId, signal); } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ fiscalEnvironment: "live", can: () => true }) }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), cnpj: { lookup: api.lookup } }));
vi.mock("@/lib/viacep", () => ({ lookupCep: vi.fn() }));

const profile = {
  legalName: "EMPRESA EXEMPLO LTDA", tradeName: "EXEMPLO",
  address: { zip: "01310100", street: "RUA DAS FLORES", number: "123", complement: "SALA 4", district: "CENTRO", city: "SAO PAULO", state: "SP" },
  municipalityCode: "3550308", simples: false, mei: true, active: true, situation: "ATIVA",
};
const VALID = "11222333000181";
const renderForm = () => render(<NextIntlClientProvider locale="en" messages={messages}><CompanyForm onSave={vi.fn()} onCancel={vi.fn()} /></NextIntlClientProvider>);
const typeCnpj = () => fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: VALID } });
const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => { api.state.calls.length = 0; });
afterEach(cleanup);

describe("CompanyForm CNPJ autofill", () => {
  it("fills names and tells the company is a MEI", async () => {
    api.state.impl = () => Promise.resolve(profile);
    renderForm(); typeCnpj();
    await waitFor(() => expect(input(/legal name/i).value).toBe("EMPRESA EXEMPLO LTDA"));
    expect(api.state.calls).toEqual([VALID]);
    expect(input(/trade name/i).value).toBe("EXEMPLO");
    expect(await screen.findByText(/This CNPJ is a MEI/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(input(/^street/i).value).toBe("RUA DAS FLORES"));
    expect(input(/city/i).value).toBe("SAO PAULO");
  });

  it("keeps manual entry when the lookup fails", async () => {
    api.state.impl = () => Promise.reject(new Error("down"));
    renderForm();
    fireEvent.change(input(/legal name/i), { target: { value: "Minha Empresa" } });
    typeCnpj();
    expect(await screen.findByText(/Fill in the details by hand/)).toBeTruthy();
    expect(input(/legal name/i).value).toBe("Minha Empresa");
    fireEvent.change(input(/legal name/i), { target: { value: "Outro nome" } });
    expect(input(/legal name/i).value).toBe("Outro nome");
  });

  it("warns when the CNPJ is not active but still lets the user edit", async () => {
    api.state.impl = () => Promise.resolve({ ...profile, active: false, situation: "BAIXADA" });
    renderForm(); typeCnpj();
    expect((await screen.findByRole("alert")).textContent).toMatch(/not active/);
    fireEvent.change(input(/legal name/i), { target: { value: "Editado" } });
    expect(input(/legal name/i).value).toBe("Editado");
  });

  it("does not look up an invalid CNPJ", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: "11222333000182" } });
    expect(api.state.calls).toEqual([]);
  });
});
