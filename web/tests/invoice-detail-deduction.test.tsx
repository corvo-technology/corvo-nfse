// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import InvoiceDetailPage from "@/app/app/invoices/[id]/page";
import type { Invoice } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "inv-1" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("@/lib/api", () => ({ invoices: { get: mocks.get, events: vi.fn() }, collectAll: async () => [] }));

afterEach(() => { cleanup(); mocks.get.mockReset(); });

const t = messages.InvoiceDetail;
const invoice = (over: Partial<Invoice> = {}) =>
  ({
    id: "inv-1", status: "authorized", amount: 1000, customerName: "Consumidor", customerTaxId: "14780306000112", externalId: null,
    competenceDate: "2026-10-19T00:00:00.000Z", serviceDescription: "Serviço de manutenção", serviceSnapshot: { code: "060101", municipalityCode: "3525003" },
    authorizedAt: "2026-10-19T12:00:00.000Z", ...over,
  }) as unknown as Invoice;

const renderPage = async (value: Invoice) => {
  mocks.get.mockResolvedValue(value);
  render(<NextIntlClientProvider locale="en" messages={messages}><InvoiceDetailPage /></NextIntlClientProvider>);
  await screen.findByText(t.service);
};

describe("invoice detail deduction", () => {
  it("shows the declared deduction next to the amount", async () => {
    await renderPage(invoice({ deduction: 400 }));
    const label = screen.getByText(t.deduction);
    const card = screen.getByText(t.service).closest("div.grid");
    expect(card!.contains(label)).toBe(true);
    expect(card!.textContent).toContain("R$");
    expect(label.parentElement!.textContent).toContain("400.00");
  });

  it("hides the deduction when the invoice has none", async () => {
    await renderPage(invoice());
    expect(screen.queryByText(t.deduction)).toBeNull();
  });
});
