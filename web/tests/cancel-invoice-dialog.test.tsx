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
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(t.options.service_not_provided.title) }));
    fireEvent.change(screen.getByLabelText(t.description), { target: { value: "  Service was not provided  " } });
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(updated));
    expect(mocks.cancel).toHaveBeenCalledWith("inv-1", { reason: "service_not_provided", description: "Service was not provided" });
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

  it("enforces the 15 character boundary on the trimmed description and caps input at 255", () => {
    renderDialog(base);
    const field = screen.getByLabelText(t.description) as HTMLTextAreaElement;
    const confirm = () => (screen.getByRole("button", { name: t.confirm }) as HTMLButtonElement).disabled;
    expect(field.getAttribute("maxlength")).toBe("255");
    fireEvent.change(field, { target: { value: `  ${"a".repeat(14)}  ` } });
    expect(confirm()).toBe(true);
    fireEvent.change(field, { target: { value: `  ${"a".repeat(15)}  ` } });
    expect(confirm()).toBe(false);
  });

  it("requires 15-255 chars for a processing invoice and warns it is being issued", () => {
    renderDialog({ ...base, status: "processing" } as Invoice);
    expect(screen.getByText(t.processingHint)).toBeTruthy();
    const field = screen.getByLabelText(t.description);
    const disabled = () => (screen.getByRole("button", { name: t.confirm }) as HTMLButtonElement).disabled;
    fireEvent.change(field, { target: { value: "a".repeat(14) } });
    expect(disabled()).toBe(true);
    fireEvent.change(field, { target: { value: "a".repeat(15) } });
    expect(disabled()).toBe(false);
    expect(field.getAttribute("maxlength")).toBe("255");
    expect(screen.queryByText(t.queuedHint)).toBeNull();
    expect(screen.queryByText(t.fiscalHint)).toBeNull();
  });

  it("starts clean when a fresh instance is mounted after an error (page mounts it only while open)", async () => {
    mocks.cancel.mockRejectedValue(new Error("boom failure"));
    const first = render(<NextIntlClientProvider locale="en" messages={messages}><CancelInvoiceDialog invoice={base} open onClose={vi.fn()} onCancelled={vi.fn()} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(t.options.refund.title) }));
    fireEvent.change(screen.getByLabelText(t.description), { target: { value: "a".repeat(20) } });
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    expect((await screen.findByRole("alert")).textContent).toContain("boom failure");
    first.unmount();
    renderDialog(base);
    expect((screen.getByLabelText(t.description) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("radio", { name: new RegExp(t.options.incorrect_data.title) }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
