// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewNfePage from "@/app/(dashboard)/app/nfe/new/page";
import type { NfeDocument } from "@/lib/nfe";
import messages from "@/messages/en.json";

const state = vi.hoisted(() => ({ params: new URLSearchParams(), nfe: true, nfce: true, doc: null as unknown }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ features: { nfe: state.nfe, nfce: state.nfce }, can: () => true }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  collectAll: async () => [{ id: "c1", legalName: "Acme Ltda", tradeName: "Acme" }],
  companies: { list: vi.fn() },
}));
vi.mock("@/lib/nfe", async (original) => ({ ...(await original<typeof import("@/lib/nfe")>()), getNfe: async () => state.doc, getNfeSettings: async () => ({ defaultCsosn: "102" }) }));

const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><NewNfePage /></NextIntlClientProvider>);

beforeEach(() => { state.params = new URLSearchParams(); state.nfe = true; state.nfce = true; state.doc = null; });
afterEach(cleanup);

describe("New NF-e / NFC-e page", () => {
  it("with only NF-e released there is no chooser and the NF-e form is shown", async () => {
    state.nfce = false;
    renderPage();
    await screen.findByRole("button", { name: "Issue NF-e" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("with both released: chooser on top, NF-e first; picking the consumer sale shows the quick form", async () => {
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

  it("with only NFC-e released it shows the quick form without a chooser", async () => {
    state.nfe = false;
    renderPage();
    await screen.findByRole("button", { name: "Issue NFC-e" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("fixing a rejected NFC-e opens the quick form on that note", async () => {
    state.params = new URLSearchParams("resubmit=n1");
    state.doc = { type: "nfce", id: "n1", companyId: "c1", recipient: null, items: [{ nItem: 1, code: "A", description: "Cafe", ncm: "09012100", cfop: "5102", unit: "UN", quantity: "1.0000", unitPrice: "5.00", total: "5.00" }], payment: { payments: [{ tPag: "17", amount: "5.00" }], change: "0.00" }, additionalInfo: null } as unknown as NfeDocument;
    renderPage();
    await screen.findByRole("button", { name: "Send NFC-e again" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
