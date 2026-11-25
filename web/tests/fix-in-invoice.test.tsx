// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewInvoicePage from "@/app/(dashboard)/app/invoices/new/page";
import InvoiceDetailPage from "@/app/(dashboard)/app/invoices/[id]/page";
import type { Company, Invoice } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), create: vi.fn(), findCustomer: vi.fn(), invoiceGet: vi.fn(), email: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), useParams: () => ({ id: "inv-1" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true, fiscalEnvironment: "test" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock("@/components/dashboard/certificate-upload", () => ({
  CertificateUpload: ({ onUploaded }: { onUploaded: (certificate: unknown) => void }) => <button onClick={() => onUploaded({ id: "cert-1" })}>fake-upload</button>,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  companies: { list: mocks.list, get: mocks.get, update: mocks.update },
  invoices: { create: mocks.create, get: mocks.invoiceGet, events: vi.fn(), email: mocks.email },
  schedules: { create: vi.fn() },
  webhooks: { deliveries: async () => ({ items: [], hasMore: false, nextCursor: null }) },
  customers: { find: mocks.findCustomer },
  collectAll: async () => [],
}));

const company: Company = {
  id: "company-1", tenantId: "tenant-1", legalName: "Example LTDA", taxId: "11222333000181", taxRegime: "Simples Nacional", simpleNational: true, simplesRate: "6.54",
  environment: "test", status: "ready", address: {}, municipalityCode: "3550308", defaultServiceCode: "010101", setupGaps: [],
  createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z",
};
const renderIn = (children: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>);
const field = (label: string) => screen.getByLabelText(new RegExp(label, "i")) as HTMLInputElement;
const fill = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const loaded = () => waitFor(() => expect(screen.getByRole("option", { name: company.legalName })).toBeTruthy());

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.list.mockResolvedValue({ items: [company], hasMore: false, nextCursor: null });
  mocks.findCustomer.mockResolvedValue(null);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("new invoice: fix without leaving", () => {
  it("keeps what was typed when the person leaves the page and comes back", async () => {
    renderIn(<NewInvoicePage />); await loaded();
    fill("Service description", "Software development"); fill("Name /", "Test customer");
    cleanup();
    renderIn(<NewInvoicePage />); await loaded();
    await waitFor(() => expect(field("Service description").value).toBe("Software development"));
    expect(field("Name /").value).toBe("Test customer");
  });

  it("clears the draft after the note is issued", async () => {
    mocks.create.mockResolvedValue({ id: "invoice-1" });
    renderIn(<NewInvoicePage />); await loaded();
    fill("CPF or CNPJ", "52998224725"); fill("Name /", "Test customer"); fill("Service description", "Software development"); fill("Total amount", "19900");
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.sendEmail.label) }));
    fireEvent.click(screen.getByRole("button", { name: messages.Invoices.submit }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(Object.keys(sessionStorage).some((key) => key.startsWith("corvo:invoice-draft:"))).toBe(false));
  });

  it("uploads the certificate in a modal and enables the submit button", async () => {
    mocks.list.mockResolvedValue({ items: [{ ...company, status: "blocked", setupGaps: ["certificate"] }], hasMore: false, nextCursor: null });
    mocks.get.mockResolvedValue({ ...company, status: "ready", setupGaps: [] });
    renderIn(<NewInvoicePage />); await loaded();
    fill("CPF or CNPJ", "52998224725"); fill("Name /", "Test customer"); fill("Service description", "Software development"); fill("Total amount", "19900");
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(messages.Invoices.sendEmail.label) }));
    const submit = () => screen.getByRole("button", { name: messages.Invoices.submit }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: messages.Invoices.fix.fixHere }));
    fireEvent.click(await screen.findByRole("button", { name: "fake-upload" }));
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(mocks.get).toHaveBeenCalledWith("company-1");
    expect(field("Service description").value).toBe("Software development");
  });

  it("sets the municipality code in the modal", async () => {
    mocks.list.mockResolvedValue({ items: [{ ...company, municipalityCode: undefined }], hasMore: false, nextCursor: null });
    mocks.update.mockResolvedValue({});
    mocks.get.mockResolvedValue(company);
    renderIn(<NewInvoicePage />); await loaded();
    fireEvent.click(screen.getByRole("button", { name: messages.Invoices.fix.fixHere }));
    fireEvent.change(await screen.findByLabelText(new RegExp(messages.Invoices.fix.municipalityCode)), { target: { value: "3550308" } });
    fireEvent.click(screen.getByRole("button", { name: messages.Invoices.fix.save }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("company-1", { municipalityCode: "3550308" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: messages.Invoices.fix.fixHere })).toBeNull());
  });
});

describe("invoice detail: resend e-mail", () => {
  const invoice = {
    id: "inv-1", status: "authorized", amount: 1000, customerName: "Cliente", customerTaxId: "14780306000112", externalId: null,
    customerSnapshot: { name: "Cliente", email: "cliente@example.com" },
    competenceDate: "2026-10-19T00:00:00.000Z", serviceDescription: "Serviço", serviceSnapshot: { code: "060101", municipalityCode: "3525003" },
    authorizedAt: "2026-10-19T12:00:00.000Z",
  } as unknown as Invoice;

  async function open() {
    mocks.invoiceGet.mockResolvedValue(invoice);
    renderIn(<InvoiceDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: messages.InvoiceDetail.resend.open }));
  }

  it("resends to the customer e-mail and shows a success toast", async () => {
    mocks.email.mockResolvedValue({ emailId: "e1", status: "queued" });
    await open();
    expect((screen.getByLabelText(new RegExp(messages.InvoiceDetail.resend.email)) as HTMLInputElement).value).toBe("cliente@example.com");
    fireEvent.click(screen.getByRole("button", { name: messages.InvoiceDetail.resend.send }));
    await waitFor(() => expect(mocks.email).toHaveBeenCalledWith("inv-1", expect.any(String), undefined));
    expect(mocks.success).toHaveBeenCalled();
  });

  it("sends to another address when edited, and shows an error toast on failure", async () => {
    mocks.email.mockRejectedValue(new Error("boom"));
    await open();
    fireEvent.change(screen.getByLabelText(new RegExp(messages.InvoiceDetail.resend.email)), { target: { value: "outro@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: messages.InvoiceDetail.resend.send }));
    await waitFor(() => expect(mocks.email).toHaveBeenCalledWith("inv-1", expect.any(String), "outro@example.com"));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  });

  it("does not offer the button before the invoice is authorized", async () => {
    mocks.invoiceGet.mockResolvedValue({ ...invoice, status: "processing", authorizedAt: null });
    renderIn(<InvoiceDetailPage />);
    await screen.findByText(messages.InvoiceDetail.service);
    expect(screen.queryByRole("button", { name: messages.InvoiceDetail.resend.open })).toBeNull();
  });
});
