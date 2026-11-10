export type InvoiceStatus =
  | 'queued'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'retry_pending'
  | 'reconciliation_required'
  | 'manual_review'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'queued',
  'processing',
  'authorized',
  'rejected',
  'retry_pending',
  'reconciliation_required',
  'manual_review',
  'failed',
  'cancelling',
  'cancelled',
];

/** Statuses in which an emission is still unresolved, so a cancellation intent can wait. */
export const EMISSION_IN_PROGRESS_STATUSES: readonly InvoiceStatus[] = [
  'processing',
  'retry_pending',
  'reconciliation_required',
];

export const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  queued: ['processing', 'rejected', 'cancelled'],
  processing: [
    'authorized',
    'rejected',
    'retry_pending',
    'reconciliation_required',
    'failed',
  ],
  retry_pending: ['processing'],
  reconciliation_required: ['authorized', 'rejected', 'manual_review'],
  // `cancelled` directly only when a substitute NFS-e is authorized: the Sefin cancels the original itself.
  authorized: ['cancelling', 'cancelled'],
  cancelling: ['cancelled', 'authorized'],
  rejected: [],
  // Resolved by a person: retried with the same DPS, or settled by what the portal answers.
  manual_review: ['reconciliation_required', 'authorized', 'rejected'],
  failed: [],
  cancelled: [],
};
