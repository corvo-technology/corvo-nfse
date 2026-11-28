// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewNfePage from "@/app/(dashboard)/app/nfe/new/page";
import type { NfeDocument } from "@/lib/nfe";
import messages from "@/messages/en.json";

const state = vi.hoisted(() => ({ params: new URLSearchParams(), doc: null as unknown }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ features: { nfeProduction: false }, fiscalEnvironment: "test", can: () => true }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  collectAll: async () => [{ id: "c1", legalName: "Acme Ltda", tradeName: "Acme" }],
  companies: { list: vi.fn() },
}));
vi.mock("@/lib/nfe", async (original) => ({ ...(await original<typeof import("@/lib/nfe")>()), getNfe: async () => state.doc, getNfeSettings: async () => ({ defaultCsosn: "102" }) }));

const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><NewNfePage /></NextIntlClientProvider>);

beforeEach(() => { state.params = new URLSearchParams(); state.doc = null; });
afterEach(cleanup);

describe("New NF-e / NFC-e page", () => {
  it("chooser on top, NF-e first; picking the consumer sale shows the quick form", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Issue NF-e" });
    expect(screen.getByRole("radiogroup", { name: "Which note do you want to issue?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Consumer sale (NFC-e)" }));
    await screen.findByRole("button", { name: "Issue NFC-e" });
    expect(screen.queryByRole("button", { name: "Issue NF-e" })).toBeNull();
  });

  it("?type=nfce opens straight on the consumer sale", async () => {
    state.params = new URLSearchParams("type=nfce");
    renderPage();
    await screen.findByRole("button", { name: "Issue NFC-e" });
  });

  it("fixing a rejected NFC-e opens the quick form on that note", async () => {
    state.params = new URLSearchParams("resubmit=n1");
    state.doc = { type: "nfce", id: "n1", companyId: "c1", recipient: null, items: [{ nItem: 1, code: "A", description: "Cafe", ncm: "09012100", cfop: "5102", unit: "UN", quantity: "1.0000", unitPrice: "5.00", total: "5.00" }], payment: { payments: [{ tPag: "17", amount: "5.00" }], change: "0.00" }, additionalInfo: null } as unknown as NfeDocument;
    renderPage();
    await screen.findByRole("button", { name: "Send NFC-e again" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  const source = (type: "nfe" | "nfce") => ({
    type, id: "n1", companyId: "c1", natOp: "Venda de mercadoria", status: "authorized", number: 7, accessKey: "K".repeat(44),
    recipient: type === "nfe" ? { taxId: "12345678909", name: "Maria da Silva", indIeDest: 9, stateRegistration: null, email: null, address: { street: "Rua A", number: "10", complement: null, district: "Centro", zip: "01001000", cityCode: "3550308", city: "São Paulo", state: "SP" } } : null,
    items: [{ nItem: 1, code: "SKU1", description: "Camiseta", ncm: "61091000", cfop: "5102", unit: "UN", quantity: "2.0000", unitPrice: "10.00", total: "20.00" }],
    payment: { payments: [{ tPag: "17", amount: "20.00" }], change: "0.00" }, additionalInfo: "Pedido 10",
  }) as unknown as NfeDocument;

  it("?from=<id> opens the NF-e form filled from the note, as a new note (no resubmit, no chooser)", async () => {
    state.params = new URLSearchParams("from=n1");
    state.doc = source("nfe");
    renderPage();
    await screen.findByRole("button", { name: "Issue NF-e" });
    expect(screen.getByRole("heading", { name: "Copy note" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send NF-e again" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Which note do you want to issue?" })).toBeNull();
    expect(screen.getByDisplayValue("Camiseta")).toBeTruthy();
    expect(screen.getByDisplayValue("Maria da Silva")).toBeTruthy();
    expect(screen.getByDisplayValue("Pedido 10")).toBeTruthy();
  });

  it("?from=<id> of a NFC-e opens the sale form filled from it", async () => {
    state.params = new URLSearchParams("from=n1");
    state.doc = source("nfce");
    renderPage();
    await screen.findByRole("button", { name: "Issue NFC-e" });
    expect(screen.getByRole("heading", { name: "Copy sale" })).toBeTruthy();
    expect(screen.getByDisplayValue("Camiseta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send NFC-e again" })).toBeNull();
  });
});
