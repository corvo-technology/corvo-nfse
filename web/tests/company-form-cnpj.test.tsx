// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyForm } from "@/components/dashboard/company-form";
import { ApiError } from "@/lib/api";
import type { Company } from "@/lib/types";
import messages from "@/messages/en.json";

// Plain functions (not vi.fn): vitest would track a rejected promise and report it as unhandled.
const api = vi.hoisted(() => {
  const state = {
    environment: "live" as "test" | "live",
    lookup: (() => Promise.resolve(null)) as (taxId: string, signal?: AbortSignal) => Promise<unknown>,
    companies: [] as { id: string; taxId: string }[],
    plan: { activeCompanies: 0, maxActiveCompanies: 999999 },
    calls: [] as string[],
  };
  return { state };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ fiscalEnvironment: api.state.environment, can: () => true }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  cnpj: { lookup: (taxId: string, signal?: AbortSignal) => { api.state.calls.push(taxId); return api.state.lookup(taxId, signal); } },
  companies: { list: () => Promise.resolve({ items: api.state.companies, hasMore: false, nextCursor: null }) },
  billing: { plan: () => Promise.resolve({ usage: api.state.plan }) },
}));
vi.mock("@/lib/viacep", () => ({ lookupCep: vi.fn() }));

const profile = {
  legalName: "EMPRESA EXEMPLO LTDA", tradeName: "EXEMPLO",
  address: { zip: "01310100", street: "RUA DAS FLORES", number: "123", complement: "SALA 4", district: "CENTRO", city: "SAO PAULO", state: "SP" },
  municipalityCode: "3550308", simples: false, mei: true, active: true, situation: "ATIVA",
};
const VALID = "11222333000181";
const onSave = vi.fn();
const renderForm = (props: { company?: Company } = {}) => render(<NextIntlClientProvider locale="en" messages={messages}><CompanyForm onSave={onSave} onCancel={vi.fn()} {...props} /></NextIntlClientProvider>);
const typeCnpj = () => fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: VALID } });
const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const continueButton = () => screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement;
const down = () => Promise.reject(new ApiError(503, "down", "CNPJ_LOOKUP_UNAVAILABLE"));

beforeEach(() => {
  api.state.environment = "live"; api.state.lookup = () => Promise.resolve(profile); api.state.companies = [];
  api.state.plan = { activeCompanies: 0, maxActiveCompanies: 999999 }; api.state.calls.length = 0; onSave.mockReset();
});
afterEach(cleanup);

describe("CompanyForm starts with the CNPJ", () => {
  it("asks only for the CNPJ on the first step", () => {
    renderForm();
    expect(input(/CNPJ/i)).toBeTruthy();
    expect(screen.queryByLabelText(/legal name/i)).toBeNull();
    expect(screen.queryByLabelText(/^street/i)).toBeNull();
    expect(continueButton().disabled).toBe(true);
  });

  it("looks the company up, shows what was found and goes on to check the details", async () => {
    renderForm(); typeCnpj();
    expect(await screen.findByText("We found: EMPRESA EXEMPLO LTDA · SAO PAULO/SP · MEI")).toBeTruthy();
    expect(api.state.calls).toEqual([VALID]);
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    expect(screen.getByText("EMPRESA EXEMPLO LTDA")).toBeTruthy();
    expect(screen.getByText("EXEMPLO")).toBeTruthy();
    expect(screen.getByText(/RUA DAS FLORES, 123/)).toBeTruthy();
    expect(screen.queryByLabelText(/^street/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(input(/legal name/i).value).toBe("EMPRESA EXEMPLO LTDA");
    expect(input(/^street/i).value).toBe("RUA DAS FLORES");
    expect(input(/city/i).value).toBe("SAO PAULO");
    fireEvent.click(continueButton());
    expect(input(/IBGE/i).value).toBe("3550308");
    expect((screen.getByLabelText(/Tax regime/i) as HTMLSelectElement).value).toBe("MEI");
  });

  it("keeps Continue off while the lookup runs", () => {
    api.state.lookup = () => new Promise(() => undefined);
    renderForm(); typeCnpj();
    expect(screen.getByText(/Looking it up/)).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });

  it("does not look up an invalid CNPJ", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: "11222333000182" } });
    expect(api.state.calls).toEqual([]);
  });

  it("blocks a CNPJ that is already registered and links to the company", async () => {
    api.state.companies = [{ id: "company-7", taxId: VALID }];
    renderForm(); typeCnpj();
    expect(await screen.findByText(/already registered/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open company" }).getAttribute("href")).toBe("/app/companies/company-7");
    expect(continueButton().disabled).toBe(true);
  });

  it("blocks in live mode when the plan has no room for another company", async () => {
    api.state.plan = { activeCompanies: 1, maxActiveCompanies: 1 };
    renderForm(); typeCnpj();
    expect(await screen.findByText(/Without a plan the account can have 1 company/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/app/billing");
    expect(continueButton().disabled).toBe(true);
  });

  it("does not apply the company limit in test mode", async () => {
    api.state.environment = "test"; api.state.plan = { activeCompanies: 1, maxActiveCompanies: 1 };
    renderForm(); typeCnpj();
    await screen.findByText(/We found/);
    await waitFor(() => expect(continueButton().disabled).toBe(false));
  });

  it("blocks a CNPJ that is not active at the Receita", async () => {
    api.state.lookup = () => Promise.resolve({ ...profile, active: false, situation: "BAIXADA" });
    renderForm(); typeCnpj();
    expect((await screen.findByRole("alert")).textContent).toMatch(/This CNPJ is BAIXADA at the Receita\. You cannot issue invoices with it\./);
    expect(continueButton().disabled).toBe(true);
  });

  it("says a CNPJ the Receita does not know is probably a typo and does not offer manual entry", async () => {
    api.state.lookup = () => Promise.reject(new ApiError(404, "no", "CNPJ_NOT_FOUND"));
    renderForm(); typeCnpj();
    expect(await screen.findByText(/could not find this CNPJ at the Receita/)).toBeTruthy();
    expect(screen.queryByLabelText(/legal name/i)).toBeNull();
    expect(continueButton().disabled).toBe(true);
  });

  it("lets the person type the company by hand when the Receita is down", async () => {
    api.state.lookup = down;
    renderForm(); typeCnpj();
    expect(await screen.findByText(/Receita lookup is down/)).toBeTruthy();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    // The legal name is required: the browser holds the form on this step until it is filled.
    expect(screen.queryByLabelText(/^street/i)).toBeNull();
    fireEvent.change(input(/legal name/i), { target: { value: "Minha Empresa" } });
    fireEvent.click(continueButton());
    expect(input(/legal name/i).value).toBe("Minha Empresa");
    expect(input(/^street/i)).toBeTruthy();
    fireEvent.click(continueButton());
    expect(screen.getByLabelText(/Tax regime/i)).toBeTruthy();
  });

  it("clears what was filled when the CNPJ changes", async () => {
    renderForm(); typeCnpj();
    await screen.findByText(/We found/);
    fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: "1122" } });
    expect(screen.queryByText(/We found/)).toBeNull();
    expect(continueButton().disabled).toBe(true);
  });
});

describe("CompanyForm service code suggestion", () => {
  const suggestion = { code: "060101", description: "Barbearia, cabeleireiros, manicuros, pedicuros e congêneres" };
  const reachFiscalStep = async () => {
    typeCnpj();
    await screen.findByText(/We found/);
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());
  };
  const serviceCombobox = () => screen.getByRole("combobox", { name: /Default service code/i }) as HTMLInputElement;

  it("offers the code that fits the activity and applies it only when asked", async () => {
    api.state.lookup = () => Promise.resolve({ ...profile, suggestedServiceCode: suggestion });
    renderForm(); await reachFiscalStep();
    expect(screen.getByText(/Suggestion from the company activity: 060101/)).toBeTruthy();
    expect(serviceCombobox().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(serviceCombobox().value).toContain("060101");
    expect(screen.queryByText(/Suggestion from the company activity/)).toBeNull();
  });

  it("shows nothing when the activity has no sure match", async () => {
    api.state.lookup = () => Promise.resolve({ ...profile, suggestedServiceCode: null });
    renderForm(); await reachFiscalStep();
    expect(screen.queryByText(/Suggestion from the company activity/)).toBeNull();
    expect(serviceCombobox().value).toBe("");
  });
});

describe("CompanyForm in edit mode", () => {
  const company: Company = {
    id: "company-1", tenantId: "tenant-1", legalName: "Example LTDA", tradeName: "Example", taxId: VALID, taxRegime: "MEI", simpleNational: true,
    environment: "live", status: "ready", address: { street: "Rua A" }, municipalityCode: "3550308", setupGaps: [],
    createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z",
  };

  it("is still one form, with the CNPJ locked and no lookup", () => {
    renderForm({ company });
    expect(input(/legal name/i).value).toBe("Example LTDA");
    expect(input(/CNPJ/i).readOnly).toBe(true);
    expect(input(/^street/i).value).toBe("Rua A");
    expect(screen.getByRole("button", { name: "Save company" })).toBeTruthy();
    expect(api.state.calls).toEqual([]);
  });
});
