// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import InvoiceDetailPage from "@/app/(dashboard)/app/invoices/[id]/page";
import type { Invoice } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ get: vi.fn(), events: vi.fn(() => [] as unknown[]) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "inv-1" }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("@/lib/api", () => ({ invoices: { get: mocks.get, events: vi.fn() }, webhooks: { deliveries: async () => ({ items: [], hasMore: false, nextCursor: null }) }, collectAll: async () => mocks.events() }));

afterEach(() => { cleanup(); mocks.get.mockReset(); mocks.events.mockReset(); mocks.events.mockReturnValue([]); });

const t = messages.InvoiceDetail;
const invoice = (over: Partial<Invoice> = {}) =>
  ({
    id: "inv-1", status: "cancelled", amount: 1000, customerName: "Consumidor", customerTaxId: "14780306000112", externalId: null,
    competenceDate: "2026-10-19T00:00:00.000Z", serviceDescription: "Consultoria em marketing", serviceSnapshot: { code: "100901", municipalityCode: "3525003" },
    authorizedAt: "2026-10-19T12:00:00.000Z", cancellationReason: "issue_error", cancellationDescription: "Estorno do serviço prestado", ...over,
  }) as unknown as Invoice;

const renderPage = async (value: Invoice) => {
  mocks.get.mockResolvedValue(value);
  render(<NextIntlClientProvider locale="en" messages={messages}><InvoiceDetailPage /></NextIntlClientProvider>);
  await screen.findByText(t.service);
};

describe("invoice detail cancellation reason", () => {
  it("shows the reason inside the invoice information card, below the service", async () => {
    await renderPage(invoice());
    const label = screen.getByText(t.cancel.reasonLabel);
    const card = screen.getByText(t.service).closest("div.grid");
    expect(card).not.toBeNull();
    expect(card!.contains(label)).toBe(true);
    expect(card!.textContent).toContain(t.cancel.reasons.issue_error);
    expect(card!.textContent).toContain("Estorno do serviço prestado");
    expect(screen.getByText(t.service).compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the reason when the invoice is not cancelling or cancelled", async () => {
    await renderPage(invoice({ status: "authorized" }));
    expect(screen.queryByText(t.cancel.reasonLabel)).toBeNull();
    expect(screen.queryByText(/Estorno do serviço prestado/)).toBeNull();
  });
});

describe("invoice detail substitution", () => {
  it("offers to substitute an authorized invoice, next to cancel", async () => {
    await renderPage(invoice({ status: "authorized", cancellationReason: null, cancellationDescription: null }));
    expect(screen.getByRole("button", { name: t.substitute.open })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.cancel.open })).toBeTruthy();
  });

  it("does not offer it for an invoice that is not authorized", async () => {
    await renderPage(invoice({ status: "queued", authorizedAt: null }));
    expect(screen.queryByRole("button", { name: t.substitute.open })).toBeNull();
  });
});

describe("invoice detail error banner and manual review", () => {
  it("hides the old error text of an authorized invoice", async () => {
    await renderPage(invoice({ status: "authorized", lastErrorCode: null, lastErrorMessage: "No conclusive answer from the fiscal portal for more than 6h." } as Partial<Invoice>));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a codeless error without the leading colon, in the user's language", async () => {
    await renderPage(invoice({ status: "manual_review", authorizedAt: null, lastErrorCode: null, lastErrorMessage: "Something odd" } as unknown as Partial<Invoice>));
    expect(screen.getByRole("alert").textContent).toBe("Something odd");
  });

  it("puts the manual review actions on top for someone who can issue", async () => {
    await renderPage(invoice({ status: "manual_review", authorizedAt: null } as unknown as Partial<Invoice>));
    expect(screen.getByRole("button", { name: /Retry/ })).toBeTruthy();
  });
});

describe("invoice timeline after a refused cancellation", () => {
  it("shows a refusal step, not a second authorization", async () => {
    mocks.events.mockReturnValue([
      { id: "e1", invoiceId: "inv-1", from: "processing", to: "authorized", at: "2026-10-19T12:00:00.000Z" },
      { id: "e2", invoiceId: "inv-1", from: "authorized", to: "cancelling", at: "2026-10-19T13:00:00.000Z", reason: "Cancellation requested" },
      { id: "e3", invoiceId: "inv-1", from: "cancelling", to: "authorized", at: "2026-10-19T13:01:00.000Z", reason: "Cancellation rejected: Rejeição da Receita [E0803]: Ambiente informado diverge" },
    ]);
    await renderPage(invoice({ status: "authorized" }));
    expect(await screen.findByText(t.timeline.cancellationRefusedTitle)).toBeTruthy();
    expect(screen.getAllByText(t.timeline.authorized)).toHaveLength(1);
    const text = screen.getByText(/The Receita did not accept the cancellation/).textContent;
    expect(text).toContain("Ambiente informado diverge");
    expect(text).not.toContain("Cancellation rejected");
  });
});
