// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulesPage from "@/app/(dashboard)/app/schedules/page";
import { ApiError } from "@/lib/api";
import type { InvoiceSchedule } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  runs: vi.fn(),
  companies: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  canIssue: true,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  schedules: { list: mocks.list, pause: mocks.pause, resume: mocks.resume, cancel: mocks.cancel, runs: mocks.runs, create: vi.fn(), update: vi.fn() },
  companies: { list: mocks.companies },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => permission === "nfse.invoices.view" || (permission === "nfse.invoices.issue" && mocks.canIssue), fiscalEnvironment: "live" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toastError, success: mocks.toastSuccess }) }));

const schedule = (over: Partial<InvoiceSchedule> = {}): InvoiceSchedule => ({
  id: "s1", kind: "recurring", frequency: "MONTHLY", status: "active", pauseReason: null, companyId: "c1",
  anchorOn: "2026-11-09", nextRunOn: "2026-11-09", endsOn: null, attempts: 0, lastRunOn: null,
  invoice: { amount: 150 }, createdAt: "2026-11-06T15:00:00.000Z", ...over,
});
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><SchedulesPage /></NextIntlClientProvider>);
const page = (items: InvoiceSchedule[]) => ({ items, hasMore: false, nextCursor: null });
const row = (id = "s1") => screen.getByTestId(`schedule-${id}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canIssue = true;
  mocks.companies.mockResolvedValue({ items: [{ id: "c1", legalName: "Acme Ltda", tradeName: "", taxId: "11222333000181" }], hasMore: false, nextCursor: null });
  mocks.list.mockResolvedValue(page([schedule()]));
});
afterEach(cleanup);

describe("Schedules page: list", () => {
  it("shows what each schedule issues, how often, when next and its status", async () => {
    renderPage();
    const r = await waitFor(() => row());
    expect(within(r).getByText("Acme Ltda")).toBeTruthy();
    expect(within(r).getByText("R$ 150,00")).toBeTruthy();
    expect(within(r).getByText("Monthly")).toBeTruthy();
    expect(within(r).getByText("Next note: 11/09/2026")).toBeTruthy();
    expect(within(r).getByText("No end date")).toBeTruthy();
    expect(within(r).getByText("Active")).toBeTruthy();
  });

  it("a single schedule says so and a deadline shows its date", async () => {
    mocks.list.mockResolvedValue(page([schedule({ id: "a", kind: "once", frequency: null }), schedule({ id: "b", endsOn: "2027-06-30" })]));
    renderPage();
    await waitFor(() => row("a"));
    expect(within(row("a")).getByText("Single")).toBeTruthy();
    expect(within(row("b")).getByText("Until 06/30/2027")).toBeTruthy();
  });

  it("a schedule paused after failures explains why and what to do", async () => {
    mocks.list.mockResolvedValue(page([schedule({ status: "paused", pauseReason: "failures", attempts: 3, nextRunOn: null })]));
    renderPage();
    const r = await waitFor(() => row());
    expect(within(r).getByText("Paused")).toBeTruthy();
    expect(within(r).getByText(/Paused after 3 failed attempts/)).toBeTruthy();
    expect(within(r).queryByText(/Next note/)).toBeNull();
  });

  it("failed attempts that have not paused it yet are mentioned", async () => {
    mocks.list.mockResolvedValue(page([schedule({ attempts: 2 })]));
    renderPage();
    expect(within(await waitFor(() => row())).getByText("2 failed attempts in a row")).toBeTruthy();
  });

  it("an empty workspace gets an explanation, and a failed load an error", async () => {
    mocks.list.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No schedules yet");
    cleanup();
    mocks.list.mockRejectedValue(new ApiError(500, "boom"));
    renderPage();
    await screen.findByText("Could not load your schedules.");
  });
});

describe("Schedules page: actions", () => {
  it("pauses an active schedule and the row updates", async () => {
    mocks.pause.mockResolvedValue(schedule({ status: "paused", pauseReason: "customer", nextRunOn: null }));
    renderPage();
    const r = await waitFor(() => row());
    fireEvent.click(within(r).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(within(row()).getByText("Paused")).toBeTruthy());
    expect(within(row()).getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("resumes a paused schedule", async () => {
    mocks.list.mockResolvedValue(page([schedule({ status: "paused", pauseReason: "failures", attempts: 3, nextRunOn: null })]));
    mocks.resume.mockResolvedValue(schedule());
    renderPage();
    const r = await waitFor(() => row());
    fireEvent.click(within(r).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(mocks.resume).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(within(row()).getByText("Active")).toBeTruthy());
  });

  it("cancelling asks first, and keeping it does nothing", async () => {
    renderPage();
    const r = await waitFor(() => row());
    fireEvent.click(within(r).getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/final/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("confirming the cancellation cancels it and removes the actions", async () => {
    mocks.cancel.mockResolvedValue(schedule({ status: "cancelled", nextRunOn: null }));
    renderPage();
    fireEvent.click(within(await waitFor(() => row())).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel schedule" }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(within(row()).getByText("Cancelled")).toBeTruthy());
    expect(within(row()).queryByRole("button", { name: "Pause" })).toBeNull();
    expect(within(row()).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("an API refusal shows a toast and leaves the row as it was", async () => {
    mocks.pause.mockRejectedValue(new ApiError(409, "The schedule is not in a state that allows this"));
    renderPage();
    fireEvent.click(within(await waitFor(() => row())).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(within(row()).getByText("Active")).toBeTruthy();
  });

  it("without the issue permission there are no actions and no new-schedule button", async () => {
    mocks.canIssue = false;
    renderPage();
    const r = await waitFor(() => row());
    expect(within(r).queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New schedule" })).toBeNull();
  });
});
