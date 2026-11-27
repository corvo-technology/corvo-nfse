import {
  buildInvoiceState,
  type InvoiceState,
} from '@/modules/invoice/domain/invoice-state';
import type { InvoiceStatus } from '@/modules/invoice/domain/invoice-status';
import type { NfeDocumentSnapshot } from './nfe-document';
import type { NfeStatus } from './nfe-status';

/** The NF-e states the NFS-e lifecycle has no name for: not authorized yet (`pending`) or final without a note (`failed`). */
const LIFECYCLE_STATUS: Record<NfeStatus, InvoiceStatus> = {
  queued: 'queued',
  contingency_pending: 'processing',
  processing: 'processing',
  authorized: 'authorized',
  rejected: 'rejected',
  denied: 'failed',
  retry_pending: 'retry_pending',
  reconciliation_required: 'reconciliation_required',
  manual_review: 'manual_review',
  cancelling: 'cancelling',
  cancelled: 'cancelled',
  discarded: 'failed',
};

/**
 * `documentsStatus`, `emailStatus` and `stage` with the same meaning as for an NFS-e: the documents
 * are ready once the `nfeProc` and the DANFE are stored (`documentsReadyAt`).
 */
export function nfeLifecycle(
  s: Pick<
    NfeDocumentSnapshot,
    'status' | 'documentsReadyAt' | 'sendEmail' | 'recipient' | 'emailStatus'
  >,
): InvoiceState {
  return buildInvoiceState({
    status: LIFECYCLE_STATUS[s.status],
    documentsReady: s.documentsReadyAt !== null,
    emailRequested: s.sendEmail && Boolean(s.recipient?.email),
    emailStatus: s.emailStatus as InvoiceState['emailStatus'],
  });
}
