import type { InvoiceStatus } from './invoice-status';

export type DocumentsStatus = 'pending' | 'ready';
export type EmailStatus = 'queued' | 'sent' | 'failed';
export type InvoiceStage =
  | 'pending'
  | 'authorized'
  | 'documents_ready'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface InvoiceStateInput {
  status: InvoiceStatus;
  documentsReady: boolean;
  emailRequested: boolean;
  emailStatus: EmailStatus | null;
}

export interface InvoiceState {
  status: InvoiceStatus;
  documentsStatus: DocumentsStatus;
  /** null when no email was sent or queued yet. */
  emailStatus: EmailStatus | null;
  /** Derived lifecycle view; never stored, so it cannot drift from the fields. */
  stage: InvoiceStage;
}

function resolveStage(input: InvoiceStateInput): InvoiceStage {
  if (input.status === 'cancelled') return 'cancelled';
  if (input.status === 'rejected' || input.status === 'failed') return 'failed';
  // A pending cancellation is still a valid NFS-e with its documents.
  const fiscal = input.status === 'cancelling' ? 'authorized' : input.status;
  if (fiscal !== 'authorized') return 'pending';
  if (!input.documentsReady) return 'authorized';
  const emailResolved =
    !input.emailRequested ||
    input.emailStatus === 'sent' ||
    input.emailStatus === 'failed';
  return emailResolved ? 'completed' : 'documents_ready';
}

export function buildInvoiceState(input: InvoiceStateInput): InvoiceState {
  return {
    status: input.status,
    documentsStatus: input.documentsReady ? 'ready' : 'pending',
    emailStatus: input.emailStatus,
    stage: resolveStage(input),
  };
}
