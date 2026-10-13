export const WEBHOOK_EVENT_STATUSES = [
  'received',
  'processing',
  'processed',
  'ignored',
  'failed',
  'manual_review',
] as const;

export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export interface WebhookEvent {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  tenantId?: string;
  resourceType?: string;
  externalResourceId?: string;
  payload?: Record<string, unknown>;
  payloadSha256: string;
  status: WebhookEventStatus;
  attempts: number;
  availableAt: Date;
  leaseUntil?: Date;
  lastError?: string;
  receivedAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebhookEventInput {
  id?: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  tenantId?: string;
  resourceType?: string;
  externalResourceId?: string;
  payload?: Record<string, unknown>;
  payloadSha256: string;
  status?: WebhookEventStatus;
  receivedAt?: Date;
  availableAt?: Date;
}

export interface ClaimWebhookEventsInput {
  now: Date;
  leaseUntil: Date;
  limit: number;
  providers?: string[];
}

export abstract class IWebhookEventRepository {
  abstract create(
    input: CreateWebhookEventInput,
  ): Promise<{ event: WebhookEvent; created: boolean }>;

  abstract findById(id: string): Promise<WebhookEvent | null>;

  abstract findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookEvent | null>;

  abstract claimPending(
    input: ClaimWebhookEventsInput,
  ): Promise<WebhookEvent[]>;

  abstract markProcessed(id: string, processedAt: Date): Promise<void>;

  abstract markIgnored(
    id: string,
    processedAt: Date,
    reason?: string,
  ): Promise<void>;

  abstract markFailed(
    id: string,
    error: string,
    availableAt: Date,
  ): Promise<void>;

  abstract markManualReview(id: string, error: string): Promise<void>;
}
