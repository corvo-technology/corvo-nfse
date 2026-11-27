// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaleResolveForm } from "@/components/dashboard/integrations/sale-resolve-form";
import { PendingSalesPanel } from "@/components/dashboard/integrations/pending-sales-panel";
import { SalesWaitingBanner } from "@/components/dashboard/integrations/sales-waiting-banner";
import IntegrationSalePage from "@/app/(dashboard)/app/integrations/sales/[id]/page";
import { parentSection } from "@/lib/route-permissions";
import type { IntegrationSale, IntegrationSaleDetail } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), ignore: vi.fn(), pending: vi.fn(), sale: vi.fn(), providers: vi.fn(), lookup: vi.fn(),
  success: vi.fn(), error: vi.fn(), permissions: new Set<string>(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  integrations: { resolve: mocks.resolve, ignore: mocks.ignore, pending: mocks.pending, sale: mocks.sale, providers: mocks.providers },
  cnpj: { lookup: mocks.lookup },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (p: string) => mocks.permissions.has(p), fiscalEnvironment: "live", tenantId: "t1" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));

const detail = (over: Partial<IntegrationSaleDetail> = {}): IntegrationSaleDetail => ({
  id: "s1", connectionId: "c1", provider: "woovi", environment: "live", operationKey: "charge:1", commercialState: "paid", fiscalStatus: "needs_attention",
  blockReason: "customer_tax_id_missing", amountCents: 990, currency: "BRL", customer: { name: "ACME LTDA", email: null, taxId: null, taxIdMasked: false },
  paidAt: "2026-11-26T15:00:00Z", invoiceId: null, createdAt: "2026-11-26T15:00:00Z", updatedAt: "2026-11-26T15:00:00Z",
  service: { code: "010101", description: "Consultoria" }, lastError: null, sendEmail: true, ...over,
});
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages}>{node}</NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(["integrations.view", "integrations.manage"]);
});
afterEach(cleanup);

describe("SaleResolveForm", () => {
  it("keeps the button off until the document is valid, then issues with the typed data", async () => {
    mocks.resolve.mockResolvedValue({ outcome: { state: "processed" }, operation: { id: "s1", invoiceId: "inv9" } });
    const onChanged = vi.fn();
    wrap(<SaleResolveForm sale={detail()} onChanged={onChanged} />);
    const emit = screen.getByRole("button", { name: "Issue invoice" }) as HTMLButtonElement;
    expect(emit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/CPF or CNPJ/), { target: { value: "11.222.333/0001-81" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "a@acme.com" } });
    fireEvent.change(screen.getByLabelText("Description on the invoice"), { target: { value: "Mentoria" } });
    expect(emit.disabled).toBe(false);
    fireEvent.click(emit);
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1));
    expect(mocks.resolve).toHaveBeenCalledWith("s1", {
      customer: { taxId: "11222333000181", name: "ACME LTDA", email: "a@acme.com" },
      service: { description: "Mentoria" },
      sendEmail: true,
    });
    expect(await screen.findByText(/Invoice issued\./)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it("without an e-mail it asks not to send, instead of failing", async () => {
    mocks.resolve.mockResolvedValue({ outcome: { state: "processed" }, operation: { id: "s1", invoiceId: "inv9" } });
    wrap(<SaleResolveForm sale={detail()} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/CPF or CNPJ/), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalled());
    expect(mocks.resolve.mock.calls[0][1]).toMatchObject({ sendEmail: false });
  });

  it("fills the name and address from the CNPJ", async () => {
    mocks.lookup.mockResolvedValue({ legalName: "ACME COMERCIO LTDA", tradeName: "Acme", address: { zip: "01001000", street: "Praca da Se", number: "1", complement: "", district: "Se", city: "Sao Paulo", state: "SP" }, municipalityCode: "3550308" });
    wrap(<SaleResolveForm sale={detail()} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/CPF or CNPJ/), { target: { value: "11222333000181" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up CNPJ data" }));
    await waitFor(() => expect((screen.getByLabelText("Name or company name") as HTMLInputElement).value).toBe("ACME COMERCIO LTDA"));
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Sao Paulo");
    expect((screen.getByLabelText("State") as HTMLInputElement).value).toBe("SP");
  });

  it("shows what still blocks the invoice when the emission is refused again", async () => {
    mocks.resolve.mockResolvedValue({ outcome: { state: "needs_attention", lastError: "quota_exceeded" }, operation: { id: "s1", invoiceId: null } });
    wrap(<SaleResolveForm sale={detail()} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/CPF or CNPJ/), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    expect(await screen.findByText(/You are out of invoice credits/)).toBeTruthy();
  });

  it("ignores the sale only with a reason", async () => {
    mocks.ignore.mockResolvedValue({});
    const onChanged = vi.fn();
    wrap(<SaleResolveForm sale={detail()} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Ignore this sale" }));
    const confirm = screen.getAllByRole("button", { name: "Ignore this sale" })[0] as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Test sale" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.ignore).toHaveBeenCalledWith("s1", "Test sale"));
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("Sale page", () => {
  it("explains the reason and what to do, and shows the form", async () => {
    mocks.sale.mockResolvedValue(detail());
    mocks.providers.mockResolvedValue([{ id: "woovi", name: "Woovi" }]);
    wrap(<IntegrationSalePage />);
    expect(await screen.findByText("The customer's CPF or CNPJ is missing.")).toBeTruthy();
    expect(screen.getByText(/Enter the customer's document and issue the invoice/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Issue invoice" })).toBeTruthy();
  });

  it("for a refused invoice, shows the underlying rule in plain words", async () => {
    mocks.sale.mockResolvedValue(detail({ blockReason: "invoice_rejected", lastError: "customer.email: customer.email is required when email notification is enabled" }));
    mocks.providers.mockResolvedValue([]);
    wrap(<IntegrationSalePage />);
    expect(await screen.findByText(/customer has no e-mail/)).toBeTruthy();
  });

  it("does not offer the form without permission to manage", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    mocks.sale.mockResolvedValue(detail());
    mocks.providers.mockResolvedValue([]);
    wrap(<IntegrationSalePage />);
    await screen.findByText("The customer's CPF or CNPJ is missing.");
    expect(screen.queryByRole("button", { name: "Issue invoice" })).toBeNull();
  });

  it("an issued sale links to its invoice instead", async () => {
    mocks.sale.mockResolvedValue(detail({ fiscalStatus: "submitted", blockReason: null, invoiceId: "inv1" }));
    mocks.providers.mockResolvedValue([]);
    wrap(<IntegrationSalePage />);
    expect((await screen.findByRole("link", { name: "View invoice" })).getAttribute("href")).toBe("/app/invoices/inv1");
  });
});

const pending = (over: Partial<IntegrationSale> = {}): IntegrationSale => ({ ...detail(), ...over });

describe("pending sales", () => {
  it("lists them with origin, value, reason and a way to resolve, for any platform", () => {
    wrap(<PendingSalesPanel loading={false} failed={false} sales={[pending(), pending({ id: "s2", provider: "stripe", blockReason: "invoice_rejected" })]} />);
    expect(screen.getByText(/Pix sale \(Woovi\)/)).toBeTruthy();
    expect(screen.getByText(/Sale \(Stripe\)/)).toBeTruthy();
    expect(screen.getAllByText("Waiting for you").length).toBe(2);
    expect(screen.getByText("The customer's CPF or CNPJ is missing.")).toBeTruthy();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/app/integrations/sales/s1", "/app/integrations/sales/s2"]);
  });

  it("says so when none wait", () => {
    wrap(<PendingSalesPanel loading={false} failed={false} sales={[]} />);
    expect(screen.getByText("No sale is waiting for you.")).toBeTruthy();
  });

  it("the overview banner counts them with the right grammar and links to the tab", async () => {
    mocks.pending.mockResolvedValue([pending()]);
    wrap(<SalesWaitingBanner />);
    expect(await screen.findByText("1 integration sale is waiting for you")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See sales" }).getAttribute("href")).toBe("/app/invoices?filter=sales");
    cleanup();
    mocks.pending.mockResolvedValue([pending(), pending({ id: "s2" })]);
    wrap(<SalesWaitingBanner />);
    expect(await screen.findByText("2 integration sales are waiting for you")).toBeTruthy();
  });

  it("the banner shows nothing when no sale waits", async () => {
    mocks.pending.mockResolvedValue([]);
    const { container } = wrap(<SalesWaitingBanner />);
    await waitFor(() => expect(mocks.pending).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("breadcrumb section", () => {
  it("a page inside Integrations belongs to Integrations", () => {
    const sections = ["/app", "/app/integrations", "/app/invoices"];
    expect(parentSection("/app/integrations/abc", sections)).toBe("/app/integrations");
    expect(parentSection("/app/integrations/sales/abc", sections)).toBe("/app/integrations");
    expect(parentSection("/app", sections)).toBeUndefined();
  });
});
