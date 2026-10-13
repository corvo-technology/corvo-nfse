export type InvoiceStatus =
  | 'queued'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'retry_pending'
  | 'reconciliation_required'
  | 'manual_review'
  | 'failed';

export const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  queued: ['processing'],
  processing: [
    'authorized',
    'rejected',
    'retry_pending',
    'reconciliation_required',
    'failed',
  ],
  retry_pending: ['processing'],
  reconciliation_required: ['authorized', 'rejected', 'manual_review'],
  authorized: [],
  rejected: [],
  manual_review: [],
  failed: [],
};
