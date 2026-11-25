import type { InvoiceStatus } from "./types";

/** The recorded reason is only meaningful while cancelling/cancelled; a Sefin-rejected cancellation returns the invoice to authorized but keeps the reason. */
export const showsCancellationReason = (status: InvoiceStatus) => status === "cancelling" || status === "cancelled";

/** Sefin justification length bounds (15–255 characters), used by the cancel dialog. */
export const CANCELLATION_DESCRIPTION_MIN = 15;
export const CANCELLATION_DESCRIPTION_MAX = 255;

/** The cancel button/dialog is offered for queued, processing (deferred until authorized) or authorized invoices, and only to users allowed to issue. */
/** Only an authorized invoice can be substituted (the API answers 409 otherwise). */
export const canSubstituteInvoice = (status: InvoiceStatus, hasPermission: boolean) => hasPermission && status === "authorized";
export const SUBSTITUTION_DESCRIPTION_MIN = 15;
export const SUBSTITUTION_DESCRIPTION_MAX = 255;

export const canCancelInvoice = (status: InvoiceStatus, hasPermission: boolean) => hasPermission && (status === "queued" || status === "processing" || status === "authorized");

/** Emission-in-progress statuses (spec §5); the Record makes the compiler require a decision for every status. */
const EMISSION_IN_PROGRESS: Record<InvoiceStatus, boolean> = {
  queued: false, processing: true, retry_pending: true, reconciliation_required: true,
  authorized: false, rejected: false, manual_review: false, failed: false, cancelling: false, cancelled: false,
};

/** A cancellation requested mid-emission is pending: show the marker while the invoice is still in an in-progress emission status. */
export const showsCancellationRequested = (status: InvoiceStatus, requestedAt?: string | null) => Boolean(requestedAt) && EMISSION_IN_PROGRESS[status];

/** The note went back from "cancelling" to "authorized": the Receita refused the cancellation, nothing was authorized again. */
export const isCancellationRefused = (event: { from?: InvoiceStatus | null; to: InvoiceStatus; source?: string | null }) =>
  event.source !== "portal" && event.from === "cancelling" && event.to === "authorized";

/** Splits the backend reason ("Cancellation rejected: Rejeição da Receita [E0803]: ...") into the Receita code and its text. */
export function cancellationRefusal(reason?: string | null): { code: string | null; message: string } {
  const message = (reason ?? "").replace(/^Cancellation rejected:\s*/i, "").trim();
  return { code: /\[(E\d+)\]/.exec(message)?.[1] ?? null, message };
}
