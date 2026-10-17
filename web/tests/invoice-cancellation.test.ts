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

const IN_PROGRESS: Record<InvoiceStatus, boolean> = {
  queued: false, processing: true, retry_pending: true, reconciliation_required: true,
  authorized: false, rejected: false, manual_review: false, failed: false, cancelling: false, cancelled: false,
};

describe("showsCancellationRequested", () => {
  const requestedAt = "2026-10-17T10:00:00.000Z";
  it.each(Object.entries(IN_PROGRESS) as [InvoiceStatus, boolean][])("%s with a request -> %s", (status, expected) => {
    expect(showsCancellationRequested(status, requestedAt)).toBe(expected);
  });
  it.each(Object.keys(IN_PROGRESS) as InvoiceStatus[])("%s without a request -> false", (status) => {
    expect(showsCancellationRequested(status, null)).toBe(false);
    expect(showsCancellationRequested(status, undefined)).toBe(false);
  });
});

describe("cancellation description bounds", () => {
  it("are 15 and 255", () => {
    expect(CANCELLATION_DESCRIPTION_MIN).toBe(15);
    expect(CANCELLATION_DESCRIPTION_MAX).toBe(255);
  });
});
