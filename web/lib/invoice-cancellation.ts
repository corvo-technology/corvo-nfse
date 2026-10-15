import type { InvoiceStatus } from "./types";

/** The recorded reason is only meaningful while cancelling/cancelled; a Sefin-rejected cancellation returns the invoice to authorized but keeps the reason. */
export const showsCancellationReason = (status: InvoiceStatus) => status === "cancelling" || status === "cancelled";
