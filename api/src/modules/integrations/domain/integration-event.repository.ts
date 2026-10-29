import type { IntegrationEnvironment } from './connector';

export type IntegrationEventState =
  | 'received'
  | 'processing'
  | 'retry_pending'
  | 'processed'
  | 'ignored'
  | 'needs_attention'
  | 'dead';

export interface NewIntegrationEvent {
  tenantId: string;
  connectionId: string;
  provider: string;
  environment: IntegrationEnvironment;
  externalAccountId: string;
  deliveryId: string;
  externalType: string;
  payloadEnc: string;
  state: Extract<IntegrationEventState, 'received' | 'needs_attention'>;
  lastError?: string;
}

export interface ClaimedEvent {
  id: string;
  tenantId: string;
  connectionId: string;
  provider: string;
  payloadEnc: string;
  attempts: number;
  claimToken: string;
}

export interface EventResult {
  state: Extract<
    IntegrationEventState,
    'processed' | 'ignored' | 'needs_attention' | 'retry_pending' | 'dead'
  >;
  operationId?: string;
  lastError?: string;
  nextAttemptAt?: Date;
}

export interface IntegrationEventSummary {
  id: string;
  deliveryId: string;
  externalType: string;
  state: IntegrationEventState;
  attempts: number;
  lastError: string | null;
  operationId: string | null;
  createdAt: Date;
}

export abstract class IIntegrationEventRepository {
  /** `created` is false when the same delivery was already stored. */
  abstract insertReceived(
    input: NewIntegrationEvent,
  ): Promise<{ id: string; created: boolean }>;

  /**
   * Takes up to `limit` due events across all tenants, each with a fresh claim
   * token and a lease of `leaseMs`. Concurrent callers never get the same event.
   */
  abstract claimBatch(
    limit: number,
    leaseMs: number,
    now: Date,
  ): Promise<ClaimedEvent[]>;

  /** False when the claim was lost (another worker took the event after the lease expired). */
  abstract markResult(
    claim: Pick<ClaimedEvent, 'id' | 'tenantId' | 'claimToken'>,
    result: EventResult,
  ): Promise<boolean>;

  /** Newest first; never exposes the stored payload. */
  abstract listByConnection(
    connectionId: string,
    tenantId: string,
    limit: number,
  ): Promise<IntegrationEventSummary[]>;
}
