// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleForm } from "@/components/schedules/schedule-form";
import { ApiError } from "@/lib/api";
import type { InvoiceSchedule } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  schedules: { create: mocks.create, update: mocks.update },
}));

const companies = [{ id: "c1", name: "Acme Ltda" }, { id: "c2", name: "Beta ME" }];
const saved: InvoiceSchedule = { id: "s1", type: "nfse", kind: "recurring", frequency: "MONTHLY", status: "active", pauseReason: null, companyId: "c1", anchorOn: "2026-11-09", nextRunOn: "2026-11-09", endsOn: null, attempts: 0, lastRunOn: null, invoice: { amount: 150 }, createdAt: "2026-11-06T15:00:00.000Z" };
const existing = (over: Partial<InvoiceSchedule> = {}): InvoiceSchedule => ({ ...saved, endsOn: "2027-06-30", invoice: { amount: 150, service: { description: "Consultoria" }, customer: { name: "Ana", taxId: "52998224725", email: "ana@example.com" }, options: { email: { send: true } } }, ...over });

const onClose = vi.fn();
const onSaved = vi.fn();
const renderForm = (schedule?: InvoiceSchedule) => render(<NextIntlClientProvider locale="en" messages={messages}><ScheduleForm open onClose={onClose} companies={companies} schedule={schedule} onSaved={onSaved} /></NextIntlClientProvider>);
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const submit = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T15:00:00Z")); // Friday noon in São Paulo
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ScheduleForm: create", () => {
  it("a single schedule has no frequency or deadline; recurring shows them", () => {
    renderForm();
    expect(screen.queryByLabelText(/Frequency/)).toBeNull();
    expect(screen.queryByLabelText(/Last day/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Recurring" }));
    expect(screen.getByLabelText(/Frequency/)).toBeTruthy();
    expect(screen.getByLabelText(/Last day/)).toBeTruthy();
  });

  it("the first date cannot be today: the minimum is tomorrow in São Paulo", () => {
    renderForm();
    expect(field(/Date of the first run/).min).toBe("2026-11-07");
  });

  it("creates a recurring schedule with the right payload and hands it back", async () => {
    mocks.create.mockResolvedValue(saved);
    renderForm();
    fireEvent.change(screen.getByLabelText(/Company/), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("radio", { name: "Recurring" }));
    fireEvent.change(screen.getByLabelText(/Frequency/), { target: { value: "MONTHLY" } });
    type(/Date of the first run/, "2026-11-09");
    type(/^Amount/, "150");
    type(/Service description/, "Consultoria");
    fireEvent.click(screen.getByLabelText(/Email the note/));
    submit(/Create schedule/);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith({
      companyId: "c1", amount: 150, competenceDate: "2026-11-09",
      service: { description: "Consultoria" },
      options: { type: "RECURRING", recurrence: { frequency: "MONTHLY" }, email: { send: true } },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(onClose).toHaveBeenCalled();
  });

  it("a deadline and a customer go into the payload; a single one is created as SCHEDULE", async () => {
    mocks.create.mockResolvedValue(saved);
    renderForm();
    fireEvent.change(screen.getByLabelText(/Company/), { target: { value: "c2" } });
    type(/Date of the first run/, "2026-11-10");
    type(/^Amount/, "99.9");
    type(/Customer name/, "Ana");
    type(/Customer tax ID/, "529.982.247-25");
    submit(/Create schedule/);
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create).toHaveBeenCalledWith({
      companyId: "c2", amount: 99.9, competenceDate: "2026-11-10",
      customer: { name: "Ana", taxId: "52998224725" },
      options: { type: "SCHEDULE" },
    });
    cleanup(); mocks.create.mockClear();
    renderForm();
    fireEvent.change(screen.getByLabelText(/Company/), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("radio", { name: "Recurring" }));
    fireEvent.change(screen.getByLabelText(/Frequency/), { target: { value: "WEEKLY" } });
    type(/Date of the first run/, "2026-11-09");
    type(/Last day/, "2027-01-31");
    type(/^Amount/, "10");
    submit(/Create schedule/);
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0].options).toEqual({ type: "RECURRING", recurrence: { frequency: "WEEKLY", endsOn: "2027-01-31" } });
  });

  it("missing company, date or amount stops before calling the API", () => {
    renderForm();
    submit(/Create schedule/);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getAllByText("Required").length).toBeGreaterThanOrEqual(3);
  });

  it("an API refusal is shown and the form stays open", async () => {
    mocks.create.mockRejectedValue(new ApiError(422, "Request validation failed", "ERROR_VALIDATION", undefined, [{ field: "competenceDate", code: "ERROR_FIRST_DATE_TOO_SOON", message: "The first date must be tomorrow or later (English from the API)" }]));
    renderForm();
    fireEvent.change(screen.getByLabelText(/Company/), { target: { value: "c1" } });
    type(/Date of the first run/, "2026-11-09");
    type(/^Amount/, "10");
    submit(/Create schedule/);
    await screen.findByText(messages.ApiErrors.first_date_too_soon);
    expect(screen.queryByText(/English from the API/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("ScheduleForm: edit", () => {
  it("is prefilled and cannot change the company or the type", () => {
    renderForm(existing());
    expect(field(/^Amount/).value).toBe("150");
    expect(field(/Service description/).value).toBe("Consultoria");
    expect((screen.getByLabelText(/Frequency/) as HTMLSelectElement).value).toBe("MONTHLY");
    expect(field(/Last day/).value).toBe("2027-06-30");
    expect(field(/Customer name/).value).toBe("Ana");
    expect(screen.queryByLabelText(/Company/)).toBeNull();
    expect(screen.queryByRole("radio", { name: "Recurring" })).toBeNull();
  });

  it("sends only what changed", async () => {
    mocks.update.mockResolvedValue(saved);
    renderForm(existing());
    type(/^Amount/, "200");
    submit(/Save changes/);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith("s1", { invoice: { amount: 200 } });
  });

  it("adds a purchase order and notes to an existing schedule, and clears them with an empty text", async () => {
    mocks.update.mockResolvedValue(saved);
    renderForm(existing());
    type(/^Purchase order/, " PO-4521 "); type(/^Notes on the invoice/, "Instalment 2 of 3");
    submit(/Save changes/);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith("s1", { invoice: { purchaseOrder: "PO-4521", notes: "Instalment 2 of 3" } });

    cleanup(); mocks.update.mockClear();
    const withOrder = existing();
    renderForm({ ...withOrder, invoice: { ...withOrder.invoice, purchaseOrder: "PO-1" } });
    expect(field(/^Purchase order/).value).toBe("PO-1");
    type(/^Purchase order/, "");
    submit(/Save changes/);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("s1", { invoice: { purchaseOrder: "" } }));
  });

  it("clearing the deadline sends null; changing the frequency sends it", async () => {
    mocks.update.mockResolvedValue(saved);
    renderForm(existing());
    type(/Last day/, "");
    fireEvent.change(screen.getByLabelText(/Frequency/), { target: { value: "WEEKLY" } });
    submit(/Save changes/);
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith("s1", { endsOn: null, frequency: "WEEKLY" });
  });

  it("saving with nothing changed does not call the API", async () => {
    renderForm(existing());
    submit(/Save changes/);
    expect(mocks.update).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
