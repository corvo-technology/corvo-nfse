// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelInvoiceDialog } from "@/components/dashboard/cancel-invoice-dialog";
import type { Invoice } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), invoices: { cancel: mocks.cancel } }));

const base = { id: "inv-1", status: "authorized" } as Invoice;
const renderDialog = (invoice: Invoice, onCancelled = vi.fn()) => {
  render(<NextIntlClientProvider locale="en" messages={messages}><CancelInvoiceDialog invoice={invoice} open onClose={vi.fn()} onCancelled={onCancelled} /></NextIntlClientProvider>);
  return onCancelled;
};
const t = messages.InvoiceDetail.cancel;

afterEach(() => { cleanup(); mocks.cancel.mockReset(); });

describe("CancelInvoiceDialog", () => {
  it("requires a 15+ character description for an authorized invoice", () => {
    renderDialog(base);
    fireEvent.change(screen.getByLabelText(t.description), { target: { value: "too short" } });
    expect((screen.getByRole("button", { name: t.confirm }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the reason and trimmed description and reports the result", async () => {
    const updated = { ...base, status: "cancelling" } as Invoice;
    mocks.cancel.mockResolvedValue(updated);
    const onCancelled = renderDialog(base);
    fireEvent.change(screen.getByLabelText(t.reason), { target: { value: "service_not_provided" } });
    fireEvent.change(screen.getByLabelText(t.description), { target: { value: "  Serviço não foi prestado  " } });
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(updated));
    expect(mocks.cancel).toHaveBeenCalledWith("inv-1", { reason: "service_not_provided", description: "Serviço não foi prestado" });
  });

  it("allows cancelling a queued invoice without a description", async () => {
    mocks.cancel.mockResolvedValue({ ...base, status: "cancelled" });
    renderDialog({ ...base, status: "queued" } as Invoice);
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("inv-1", { reason: "issue_error", description: undefined }));
  });

  it("shows the API error and keeps the dialog open", async () => {
    mocks.cancel.mockRejectedValue(new Error("Invoice cannot be cancelled in its current status"));
    renderDialog({ ...base, status: "queued" } as Invoice);
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot be cancelled");
  });
});
