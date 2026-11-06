// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScheduleDetailPage from "@/app/(dashboard)/app/schedules/[id]/page";
import type { InvoiceSchedule } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ get: vi.fn(), runs: vi.fn(), pause: vi.fn(), companies: vi.fn(), canIssue: true }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  schedules: { get: mocks.get, runs: mocks.runs, pause: mocks.pause },
  companies: { list: mocks.companies },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => mocks.canIssue }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

const schedule: InvoiceSchedule = {
  id: "s1", kind: "recurring", frequency: "MONTHLY", status: "active", pauseReason: null, companyId: "c1",
  anchorOn: "2026-12-06", nextRunOn: "2026-12-06", endsOn: null, attempts: 0, lastRunOn: null, createdAt: "2026-11-06T15:00:00.000Z",
  invoice: { amount: 200, deduction: 12.22, customer: { name: "Padaria Estrela", taxId: "52998224725", email: "ana@example.com" }, service: { description: "Consultoria" }, options: { email: { send: true } } },
};
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><ScheduleDetailPage /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks(); mocks.canIssue = true;
  mocks.get.mockResolvedValue(schedule);
  mocks.runs.mockResolvedValue({ items: [{ id: "r1", occurrenceOn: "2026-12-06", ranOn: "2026-12-07", attempt: 1, outcome: "issued", invoiceId: "inv-1", errorCode: null, errorMessage: null, createdAt: "2026-12-07T12:00:00.000Z" }], hasMore: false, nextCursor: null });
  mocks.companies.mockResolvedValue({ items: [{ id: "c1", legalName: "Acme Ltda", tradeName: "", taxId: "11222333000181" }], hasMore: false, nextCursor: null });
});
afterEach(cleanup);

describe("schedule details", () => {
  it("shows who the note is for, what it says, how it repeats and the run history", async () => {
    renderPage();
    await screen.findByText("Padaria Estrela");
    expect(screen.getByText("529.982.247-25")).toBeTruthy();
    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(screen.getByText("Consultoria")).toBeTruthy();
    expect(screen.getAllByText("R$ 200,00").length).toBeGreaterThan(0);
    expect(screen.getByText("R$ 12,22")).toBeTruthy();
    expect(screen.getByText("Sends the PDF and XML to the customer")).toBeTruthy();
    expect(screen.getAllByText("Acme Ltda").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12/06/2026").length).toBeGreaterThan(0);
    expect(await screen.findByTestId("schedule-run")).toBeTruthy();
  });

  it("pausing from the details updates the status", async () => {
    mocks.pause.mockResolvedValue({ ...schedule, status: "paused", pauseReason: "customer", nextRunOn: null });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith("s1"));
    await screen.findByRole("button", { name: "Resume" });
  });

  it("without the issue permission there are no controls", async () => {
    mocks.canIssue = false;
    renderPage();
    await screen.findByText("Padaria Estrela");
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("an unknown schedule says so and links back", async () => {
    mocks.get.mockRejectedValue(new Error("404"));
    renderPage();
    await screen.findByText("Schedule not found.");
    expect(screen.getByRole("link", { name: "Back to scheduled" }).getAttribute("href")).toBe("/app/invoices?filter=scheduled");
  });
});
