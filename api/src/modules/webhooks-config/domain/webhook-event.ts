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
  | 'nfse.invoice.email_failed';

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
