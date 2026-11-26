export type WebhookEventType =
  | 'webhook.test'
  // NFS-e events
  | 'nfse.invoice.authorized'
  | 'nfse.invoice.rejected'
  | 'nfse.invoice.failed'
  | 'nfse.invoice.reconciliation_required'
  | 'nfse.invoice.manual_review'
  | 'nfse.invoice.documents_ready'
  | 'nfse.invoice.email_sent'
  | 'nfse.invoice.email_failed'
  | 'nfse.invoice.fiscal_discrepancy'
  | 'nfse.invoice.cancelled'
  | 'nfse.invoice.cancellation_rejected'
  | 'nfse.invoice.taker_rejected'
  // NF-e events
  | 'nfe.document.authorized'
  | 'nfe.document.rejected'
  | 'nfe.document.denied'
  | 'nfe.document.failed'
  | 'nfe.document.reconciliation_required'
  | 'nfe.document.manual_review'
  | 'nfe.document.documents_ready'
  | 'nfe.document.email_sent'
  | 'nfe.document.email_failed'
  | 'nfe.document.cancelled'
  | 'nfe.document.cancellation_rejected'
  | 'nfe.document.corrected'
  | 'nfe.inutilization.completed'
  | 'nfe.inutilization.rejected'
  // NFC-e events
  | 'nfce.document.authorized'
  | 'nfce.document.rejected'
  | 'nfce.document.denied'
  | 'nfce.document.failed'
  | 'nfce.document.reconciliation_required'
  | 'nfce.document.manual_review'
  | 'nfce.document.documents_ready'
  | 'nfce.document.email_sent'
  | 'nfce.document.email_failed'
  | 'nfce.document.cancelled'
  | 'nfce.document.cancellation_rejected'
  | 'nfce.inutilization.completed'
  | 'nfce.inutilization.rejected';

/** Event types a tenant may subscribe to through the public API. */
export const PUBLIC_WEBHOOK_EVENT_TYPES = [
  'nfse.invoice.authorized',
  'nfse.invoice.rejected',
  'nfse.invoice.failed',
  'nfse.invoice.reconciliation_required',
  'nfse.invoice.manual_review',
  'nfse.invoice.documents_ready',
  'nfse.invoice.email_sent',
  'nfse.invoice.email_failed',
  'nfse.invoice.fiscal_discrepancy',
  'nfse.invoice.cancelled',
  'nfse.invoice.cancellation_rejected',
  'nfse.invoice.taker_rejected',
  'nfe.document.authorized',
  'nfe.document.rejected',
  'nfe.document.denied',
  'nfe.document.failed',
  'nfe.document.reconciliation_required',
  'nfe.document.manual_review',
  'nfe.document.documents_ready',
  'nfe.document.email_sent',
  'nfe.document.email_failed',
  'nfe.document.cancelled',
  'nfe.document.cancellation_rejected',
  'nfe.document.corrected',
  'nfe.inutilization.completed',
  'nfe.inutilization.rejected',
  'nfce.document.authorized',
  'nfce.document.rejected',
  'nfce.document.denied',
  'nfce.document.failed',
  'nfce.document.reconciliation_required',
  'nfce.document.manual_review',
  'nfce.document.documents_ready',
  'nfce.document.email_sent',
  'nfce.document.email_failed',
  'nfce.document.cancelled',
  'nfce.document.cancellation_rejected',
  'nfce.inutilization.completed',
  'nfce.inutilization.rejected',
] as const satisfies readonly WebhookEventType[];

export type PublicWebhookEventType =
  (typeof PUBLIC_WEBHOOK_EVENT_TYPES)[number];

export type WebhookEnvironment = 'live' | 'test';

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  environment: WebhookEnvironment;
  createdAt: string;
  data: Record<string, unknown>;
}
