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

export abstract class IIntegrationEventRepository {
  /** `created` is false when the same delivery was already stored. */
  abstract insertReceived(
    input: NewIntegrationEvent,
  ): Promise<{ id: string; created: boolean }>;
}
