export type NfeStatus =
  | 'queued'
  | 'contingency_pending'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'denied'
  | 'retry_pending'
  | 'reconciliation_required'
  | 'manual_review'
  | 'cancelling'
  | 'cancelled'
  | 'discarded';

export const NFE_STATUSES: readonly NfeStatus[] = [
  'queued',
  'contingency_pending',
  'processing',
  'authorized',
  'rejected',
  'denied',
  'retry_pending',
  'reconciliation_required',
  'manual_review',
  'cancelling',
  'cancelled',
  'discarded',
];

/**
 * Design spec 8.3. `denied`, `cancelled` and `discarded` are final. A rejected document goes back
 * to `queued` (corrected and resubmitted with the same number) or to `discarded` (its number then
 * needs an inutilization).
 */
export const NFE_VALID_TRANSITIONS: Record<NfeStatus, NfeStatus[]> = {
  queued: ['processing'],
  // NFC-e issued off-line (`tpEmis` 9): delivered to the consumer already, waiting to be transmitted.
  contingency_pending: ['processing'],
  processing: [
    'authorized',
    'rejected',
    'denied',
    'retry_pending',
    'reconciliation_required',
    'contingency_pending',
  ],
  retry_pending: ['processing'],
  reconciliation_required: [
    'authorized',
    'rejected',
    'denied',
    'manual_review',
  ],
  manual_review: ['reconciliation_required', 'authorized', 'rejected'],
  authorized: ['cancelling'],
  cancelling: ['cancelled', 'authorized'],
  rejected: ['queued', 'contingency_pending', 'discarded'],
  denied: [],
  cancelled: [],
  discarded: [],
};

export function isFinalNfeStatus(status: NfeStatus): boolean {
  return NFE_VALID_TRANSITIONS[status].length === 0;
}
