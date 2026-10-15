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

export const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  queued: ['processing', 'cancelled'],
  processing: [
    'authorized',
    'rejected',
    'retry_pending',
    'reconciliation_required',
    'failed',
  ],
  retry_pending: ['processing'],
  reconciliation_required: ['authorized', 'rejected', 'manual_review'],
  authorized: ['cancelling'],
  cancelling: ['cancelled', 'authorized'],
  rejected: [],
  manual_review: [],
  failed: [],
  cancelled: [],
};
