import { describe, expect, it } from "vitest";
import { CANCELLATION_DESCRIPTION_MAX, CANCELLATION_DESCRIPTION_MIN, canCancelInvoice } from "@/lib/invoice-cancellation";
import type { InvoiceStatus } from "@/lib/types";

const ALL: InvoiceStatus[] = ["queued", "processing", "authorized", "rejected", "retry_pending", "reconciliation_required", "manual_review", "failed", "cancelling", "cancelled"];

describe("canCancelInvoice", () => {
  it.each(ALL)("only queued/authorized with permission can be cancelled (%s)", (status) => {
    const expected = status === "queued" || status === "authorized";
    expect(canCancelInvoice(status, true)).toBe(expected);
    expect(canCancelInvoice(status, false)).toBe(false);
  });
});

describe("cancellation description bounds", () => {
  it("are 15 and 255", () => {
    expect(CANCELLATION_DESCRIPTION_MIN).toBe(15);
    expect(CANCELLATION_DESCRIPTION_MAX).toBe(255);
  });
});
