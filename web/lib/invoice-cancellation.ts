import type { InvoiceStatus } from "./types";

/** The recorded reason is only meaningful while cancelling/cancelled; a Sefin-rejected cancellation returns the invoice to authorized but keeps the reason. */
export const showsCancellationReason = (status: InvoiceStatus) => status === "cancelling" || status === "cancelled";

/** Sefin justification length bounds (15–255 characters), used by the cancel dialog. */
export const CANCELLATION_DESCRIPTION_MIN = 15;
export const CANCELLATION_DESCRIPTION_MAX = 255;

/** The cancel button/dialog is offered only for queued or authorized invoices, and only to users allowed to issue. */
export const canCancelInvoice = (status: InvoiceStatus, hasPermission: boolean) => hasPermission && (status === "queued" || status === "authorized");
