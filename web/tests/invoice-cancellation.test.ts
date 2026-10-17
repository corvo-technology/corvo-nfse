import { describe, expect, it } from "vitest";
import { CANCELLATION_DESCRIPTION_MAX, CANCELLATION_DESCRIPTION_MIN, canCancelInvoice, showsCancellationRequested } from "@/lib/invoice-cancellation";
import type { InvoiceStatus } from "@/lib/types";

const CANCELLABLE: Record<InvoiceStatus, boolean> = {
  queued: true, processing: true, authorized: true,
  rejected: false, retry_pending: false, reconciliation_required: false, manual_review: false, failed: false, cancelling: false, cancelled: false,
};

describe("canCancelInvoice", () => {
  it.each(Object.entries(CANCELLABLE) as [InvoiceStatus, boolean][])("%s -> %s with permission, never without", (status, expected) => {
    expect(canCancelInvoice(status, true)).toBe(expected);
    expect(canCancelInvoice(status, false)).toBe(false);
  });
});

describe("showsCancellationRequested", () => {
  it("shows only with a request timestamp and an in-progress emission status", () => {
    expect(showsCancellationRequested("processing", "2026-10-17T10:00:00.000Z")).toBe(true);
    expect(showsCancellationRequested("retry_pending", "2026-10-17T10:00:00.000Z")).toBe(true);
    expect(showsCancellationRequested("processing", null)).toBe(false);
    expect(showsCancellationRequested("processing", undefined)).toBe(false);
    expect(showsCancellationRequested("authorized", "2026-10-17T10:00:00.000Z")).toBe(false);
    expect(showsCancellationRequested("cancelled", "2026-10-17T10:00:00.000Z")).toBe(false);
  });
});

describe("cancellation description bounds", () => {
  it("are 15 and 255", () => {
    expect(CANCELLATION_DESCRIPTION_MIN).toBe(15);
    expect(CANCELLATION_DESCRIPTION_MAX).toBe(255);
  });
});
