import type { NormalizedCustomer } from '../domain/connector';
import {
  mergeCommercialState,
  type BlockReason,
  type FiscalStatus,
  type IntegrationOperation,
} from '../domain/integration-operation';
import {
  IIntegrationOperationRepository,
  type FrozenEmission,
} from '../domain/integration-operation.repository';
import { IIntegrationRuleRepository } from '../domain/integration-rule.repository';
import type { IntegrationRule } from '../domain/integration-rule';

/** In-memory fakes with the same semantics as the Postgres repositories. */
export class MemoryOperations extends IIntegrationOperationRepository {
  rows = new Map<string, IntegrationOperation>();
  private seq = 0;

  upsertFromNormalized(
    input: Parameters<
      IIntegrationOperationRepository['upsertFromNormalized']
    >[0],
  ) {
    const key = `${input.tenantId}|${input.environment}|${input.provider}|${input.externalAccountId}|${input.normalized.operationKey}`;
    const existing = [...this.rows.values()].find(
      (r) =>
        `${r.tenantId}|${r.environment}|${r.provider}|${r.externalAccountId}|${r.operationKey}` ===
        key,
    );
    if (!existing) {
      const row: IntegrationOperation = {
        id: `op${++this.seq}`,
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        provider: input.provider,
        environment: input.environment,
        externalAccountId: input.externalAccountId,
        operationKey: input.normalized.operationKey,
        commercialState: input.normalized.commercialState,
        fiscalStatus: 'none',
        blockReason: null,
        snapshot: input.normalized,
        ruleId: null,
        emissionRequest: null,
        emissionRequestHash: null,
        idempotencyKey: null,
        invoiceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.rows.set(row.id, row);
      return Promise.resolve(row);
    }
    const merged = mergeCommercialState(
      existing.commercialState,
      input.normalized.commercialState,
    );
    const advanced = merged !== existing.commercialState;
    const updated = {
      ...existing,
      commercialState: merged,
      snapshot: advanced ? input.normalized : existing.snapshot,
    };
    this.rows.set(existing.id, updated);
    return Promise.resolve(updated);
  }
  findById(id: string, tenantId: string) {
    const row = this.rows.get(id);
    return Promise.resolve(row && row.tenantId === tenantId ? row : null);
  }
  listByConnection() {
    return Promise.resolve([...this.rows.values()]);
  }
  freezeEmission(id: string, _tenantId: string, emission: FrozenEmission) {
    const row = this.rows.get(id)!;
    if (!row.emissionRequest) {
      const frozen = {
        ...row,
        ruleId: emission.ruleId,
        emissionRequest: emission.request,
        emissionRequestHash: emission.requestHash,
        idempotencyKey: emission.idempotencyKey,
      };
      this.rows.set(id, frozen);
      return Promise.resolve(frozen);
    }
    return Promise.resolve(row);
  }
  unfreezeEmission(id: string) {
    const row = this.rows.get(id)!;
    this.rows.set(id, {
      ...row,
      ruleId: null,
      emissionRequest: null,
      emissionRequestHash: null,
      idempotencyKey: null,
    });
    return Promise.resolve();
  }
  setFiscal(
    id: string,
    _tenantId: string,
    status: FiscalStatus,
    blockReason: BlockReason | null,
    invoiceId?: string,
  ) {
    const row = this.rows.get(id)!;
    this.rows.set(id, {
      ...row,
      fiscalStatus: status,
      blockReason,
      invoiceId: invoiceId ?? row.invoiceId,
    });
    return Promise.resolve();
  }
  updateCustomer(id: string, _tenantId: string, customer: NormalizedCustomer) {
    const row = this.rows.get(id)!;
    if (row.emissionRequest) return Promise.resolve(null);
    const updated: IntegrationOperation = {
      ...row,
      snapshot: { ...row.snapshot, customer },
      fiscalStatus: 'none',
      blockReason: null,
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

export class MemoryRules extends IIntegrationRuleRepository {
  rules: IntegrationRule[] = [];
  countByConnection() {
    return Promise.resolve(this.rules.length);
  }
  listByConnection() {
    return Promise.resolve(this.rules);
  }
  replaceForConnection(
    connectionId: string,
    tenantId: string,
    rules: Array<Omit<IntegrationRule, 'id' | 'tenantId' | 'connectionId'>>,
  ) {
    this.rules = rules.map((r, i) => ({
      ...r,
      id: `r${i + 1}`,
      tenantId,
      connectionId,
    }));
    return Promise.resolve(this.rules);
  }
}
