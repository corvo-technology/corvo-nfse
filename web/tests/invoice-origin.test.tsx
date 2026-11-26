// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import InvoiceDetailPage from "@/app/(dashboard)/app/invoices/[id]/page";
import { invoiceOrigin, originText } from "@/lib/invoice-origin";
import type { Invoice } from "@/lib/types";
import messages from "@/messages/en.json";
import pt from "@/messages/pt.json";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "inv-1" }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("@/lib/api", () => ({ invoices: { get: mocks.get, events: vi.fn() }, webhooks: { deliveries: async () => ({ items: [], hasMore: false, nextCursor: null }) }, collectAll: async () => [] }));

afterEach(() => { cleanup(); mocks.get.mockReset(); });

const t = (key: string, values?: Record<string, string>) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages.InvoiceOrigin) as string;
  return Object.entries(values ?? {}).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), text);
};
const text = (idempotencyKey: string | null, externalId: string | null) => originText(invoiceOrigin({ idempotencyKey, externalId }), t);

describe("invoiceOrigin", () => {
  it.each([
    ["integ_abc", "charge:441d455e-fc37-4847-b539-2df1cd4593be", "Pix sale (Woovi) · charge 441d455e"],
    ["integ_abc", "checkout:bill_abc123xyz456", "Sale (AbacatePay) · charge bill_abc"],
    ["integ_abc", "transparent:pix_1", "Sale (AbacatePay) · charge pix_1"],
    ["integ_abc", "pushinpay:9c8a1f4e-2b7d-4c6a", "Sale (PushinPay) · charge 9c8a1f4e"],
    ["integ_abc", "stripe_charge:ch_3SabcdefGHIJ", "Sale (Stripe) · charge ch_3Sabc"],
    ["integ_abc", "kiwify:9b1c2d3e-0000-4000-8000-000000000001", "Sale (Kiwify) · charge 9b1c2d3e"],
    ["integ_abc", "weird", "Integration sale"],
    ["schedule:s1:2026-01-05", null, "Schedule"],
    ["import:i1:3", "linha-3", "Spreadsheet import"],
    ["k1", "dashboard-9f2", "Dashboard"],
    ["k1", "pedido-12", "API"],
    [null, null, "API"],
  ])("%s / %s -> %s", (key, externalId, expected) => {
    expect(text(key, externalId)).toBe(expected);
  });

  it("has the same keys in Portuguese", () => {
    expect(Object.keys(pt.InvoiceOrigin).sort()).toEqual(Object.keys(messages.InvoiceOrigin).sort());
    expect(Object.keys(pt.InvoiceOrigin.kind).sort()).toEqual(Object.keys(messages.InvoiceOrigin.kind).sort());
  });
});

const invoice = (over: Partial<Invoice>) =>
  ({
    id: "inv-1", status: "authorized", amount: 1000, customerName: "Consumidor", customerTaxId: "14780306000112",
    competenceDate: "2026-10-19T00:00:00.000Z", serviceDescription: "Serviço", serviceSnapshot: { code: "060101", municipalityCode: "3525003" },
    authorizedAt: "2026-10-19T12:00:00.000Z", ...over,
  }) as unknown as Invoice;

const renderPage = async (value: Invoice) => {
  mocks.get.mockResolvedValue(value);
  render(<NextIntlClientProvider locale="en" messages={messages}><InvoiceDetailPage /></NextIntlClientProvider>);
  await screen.findByText(messages.InvoiceDetail.service);
};

describe("invoice detail origin", () => {
  it("shows a friendly origin for an integration sale and keeps the raw reference small", async () => {
    await renderPage(invoice({ idempotencyKey: "integ_abc", externalId: "charge:441d455e-fc37-4847-b539-2df1cd4593be" }));
    expect(screen.getByText("Pix sale (Woovi) · charge 441d455e")).toBeTruthy();
    expect(screen.getByTestId("raw-reference").textContent).toBe("charge:441d455e-fc37-4847-b539-2df1cd4593be");
  });

  it("shows the client's own reference as sent, labeled as theirs", async () => {
    await renderPage(invoice({ idempotencyKey: "k1", externalId: "pedido-12" }));
    expect(screen.getByText("Your reference")).toBeTruthy();
    expect(screen.getByText("pedido-12")).toBeTruthy();
    expect(screen.queryByTestId("raw-reference")).toBeNull();
  });
});
