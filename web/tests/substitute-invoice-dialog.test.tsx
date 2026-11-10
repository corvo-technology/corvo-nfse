// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubstituteInvoiceDialog } from "@/components/dashboard/substitute-invoice-dialog";
import { ApiError } from "@/lib/api";
import type { Invoice } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ substitute: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), invoices: { substitute: mocks.substitute } }));

const original = { id: "inv-1", status: "authorized", serviceSnapshot: { description: "Consulting", code: "010601", municipalityCode: "3550308", purchaseOrder: "PO-1", notes: "Instalment 1" } } as Invoice;
const t = messages.InvoiceDetail.substitute;
const renderDialog = (onSubstituted = vi.fn()) => {
  render(<NextIntlClientProvider locale="en" messages={messages}><SubstituteInvoiceDialog invoice={original} open onClose={vi.fn()} onSubstituted={onSubstituted} /></NextIntlClientProvider>);
  return onSubstituted;
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
const confirm = () => screen.getByRole("button", { name: t.confirm }) as HTMLButtonElement;
afterEach(() => { cleanup(); mocks.substitute.mockReset(); });

describe("SubstituteInvoiceDialog", () => {
  it("says what cannot change and that a credit is used", () => {
    renderDialog();
    expect(screen.getByText(t.locked)).toBeTruthy();
    expect(screen.getByText(t.credit)).toBeTruthy();
  });

  it("needs a reason of 15 characters or more", () => {
    renderDialog();
    expect(confirm().disabled).toBe(true);
    type(t.reason, "too short");
    expect(confirm().disabled).toBe(true);
    type(t.reason, "Service description corrected");
    expect(confirm().disabled).toBe(false);
  });

  it("sends only what changed, with one idempotency key, and reports the substitute", async () => {
    const substitute = { id: "inv-2", status: "queued" } as Invoice;
    mocks.substitute.mockResolvedValue(substitute);
    const onSubstituted = renderDialog();
    type(t.reason, "  Service description corrected  ");
    type(t.serviceDescription, "Consulting, October 2026");
    type(t.purchaseOrder, "");
    fireEvent.click(confirm());
    await waitFor(() => expect(onSubstituted).toHaveBeenCalledWith(substitute));
    expect(mocks.substitute).toHaveBeenCalledWith(
      "inv-1",
      { description: "Service description corrected", service: { description: "Consulting, October 2026" }, purchaseOrder: "" },
      expect.stringMatching(/^substitute-inv-1-/),
    );
  });

  it("shows the API refusal and keeps the dialog open", async () => {
    mocks.substitute.mockRejectedValue(new ApiError(409, "Only an authorized invoice can be substituted", "ERROR_INVOICE_NOT_SUBSTITUTABLE"));
    const onSubstituted = renderDialog();
    type(t.reason, "Service description corrected");
    fireEvent.click(confirm());
    expect((await screen.findByRole("alert")).textContent).toContain("authorized");
    expect(onSubstituted).not.toHaveBeenCalled();
  });
});
