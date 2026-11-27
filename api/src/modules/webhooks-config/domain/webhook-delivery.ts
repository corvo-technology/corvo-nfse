import { WebhookEvent } from './webhook-event';

export type WebhookDeliveryStatus =
  'pending' | 'sent' | 'delayed' | 'failed' | 'manual_retry';

export interface WebhookDelivery {
  id: string;
  tenantId: string;
  webhookConfigId: string;
  /** The invoice the event is about; absent for events like `webhook.test`. */
  invoiceId?: string;
  /** The NF-e (or other fiscal document that is not an NFS-e invoice) the event is about. */
  documentId?: string;
  eventType: string;
  environment: 'live' | 'test';
  url: string;
  /** Canonical event body retained so every retry sends the exact same event. */
  payload?: WebhookEvent;
  statusCode?: number;
  responseBody?: string;
  errorMessage?: string;
  status: WebhookDeliveryStatus;
  durationMs?: number;
  retryCount: number;
  nextRetryAt?: Date;
  lastError?: string;
  createdAt: Date;
}
