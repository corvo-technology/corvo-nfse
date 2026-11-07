// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvoicesPage from "@/app/(dashboard)/app/invoices/page";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ invoices: vi.fn(), schedules: vi.fn(), companies: vi.fn(), filter: null as string | null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.filter ? { filter: mocks.filter } : {}) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true, fiscalEnvironment: "live" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  invoices: { list: mocks.invoices },
  schedules: { list: mocks.schedules },
  companies: { list: mocks.companies },
}));

const invoice = (id: string, name: string, status: string) => ({ id, customerName: name, amount: 100, status, createdAt: "2026-10-16T12:00:00.000Z", externalId: null });
const schedule = { id: "s1", kind: "recurring", frequency: "MONTHLY", status: "active", pauseReason: null, companyId: "c1", anchorOn: "2026-11-09", nextRunOn: "2026-11-09", endsOn: null, attempts: 0, lastRunOn: null, invoice: { amount: 150 }, createdAt: "2026-11-06T15:00:00.000Z" };
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><InvoicesPage /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks(); mocks.filter = null;
  mocks.invoices.mockResolvedValue({ items: [invoice("a", "Padaria Estrela", "authorized"), invoice("b", "Oficina Sol", "cancelled")], hasMore: false, nextCursor: null });
  mocks.schedules.mockResolvedValue({ items: [schedule], hasMore: false, nextCursor: null });
  mocks.companies.mockResolvedValue({ items: [{ id: "c1", legalName: "Acme Ltda", tradeName: "", taxId: "11222333000181" }], hasMore: false, nextCursor: null });
});
afterEach(cleanup);

describe("notes list filters", () => {
  it("offers the spreadsheet import next to the new note button", async () => {
    renderPage();
    await screen.findAllByText("Padaria Estrela");
    expect(screen.getByRole("link", { name: /import spreadsheet/i }).getAttribute("href")).toBe("/app/invoices/import");
    expect(screen.getByRole("link", { name: /new invoice|new note/i }).getAttribute("href")).toBe("/app/invoices/new");
  });

  it("Cancelled shows only the cancelled notes", async () => {
    renderPage();
    await screen.findAllByText("Padaria Estrela");
    fireEvent.click(screen.getByRole("button", { name: /Cancelled/ }));
    expect(screen.getAllByText("Oficina Sol").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Padaria Estrela")).toHaveLength(0);
  });

  it("Scheduled shows the schedules, with their controls, instead of the notes", async () => {
    renderPage();
    await screen.findAllByText("Padaria Estrela");
    fireEvent.click(screen.getByRole("button", { name: /Scheduled/ }));
    expect(await screen.findByTestId("schedule-s1")).toBeTruthy();
    expect(screen.queryAllByText("Padaria Estrela")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "New schedule" })).toBeNull();
  });

  it("opens on Scheduled when the link says so (old e-mail links land here)", async () => {
    mocks.filter = "scheduled";
    renderPage();
    expect(await screen.findByTestId("schedule-s1")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: /Scheduled/ }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("the schedules are not loaded while another filter is open", async () => {
    renderPage();
    await screen.findAllByText("Padaria Estrela");
    expect(mocks.schedules).not.toHaveBeenCalled();
  });
});
