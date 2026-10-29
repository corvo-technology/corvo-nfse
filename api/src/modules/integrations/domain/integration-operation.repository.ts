import type { NormalizedCustomer, NormalizedOperation } from './connector';
import type {
  BlockReason,
  FiscalStatus,
  IntegrationOperation,
} from './integration-operation';

export interface FrozenEmission {
  ruleId: string;
  request: Record<string, unknown>;
  requestHash: string;
  idempotencyKey: string;
}

export abstract class IIntegrationOperationRepository {
  /** Atomic upsert by operation key; the commercial state only moves forward. */
  abstract upsertFromNormalized(input: {
    tenantId: string;
    connectionId: string;
    provider: string;
    environment: 'test' | 'live';
    externalAccountId: string;
    normalized: NormalizedOperation;
  }): Promise<IntegrationOperation>;
  abstract findById(
    id: string,
    tenantId: string,
  ): Promise<IntegrationOperation | null>;
  abstract listByConnection(
    connectionId: string,
    tenantId: string,
    limit: number,
  ): Promise<IntegrationOperation[]>;
  /** Stores the emission request once; later calls keep the first. Returns the stored operation. */
  abstract freezeEmission(
    id: string,
    tenantId: string,
    emission: FrozenEmission,
  ): Promise<IntegrationOperation>;
  /**
   * Drops the frozen request so the next attempt plans again. Only for
   * failures that happened before any invoice was created under the key.
   */
  abstract unfreezeEmission(id: string, tenantId: string): Promise<void>;
  abstract setFiscal(
    id: string,
    tenantId: string,
    status: FiscalStatus,
    blockReason: BlockReason | null,
    invoiceId?: string,
  ): Promise<void>;
  /** Only while the request is not frozen; returns null otherwise. */
  abstract updateCustomer(
    id: string,
    tenantId: string,
    customer: NormalizedCustomer,
  ): Promise<IntegrationOperation | null>;
}
