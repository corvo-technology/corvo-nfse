import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { NormalizedCustomer } from '../domain/connector';
import {
  parseSnapshot,
  type BlockReason,
  type FiscalStatus,
  type IntegrationOperation,
} from '../domain/integration-operation';
import {
  IIntegrationOperationRepository,
  type FrozenEmission,
} from '../domain/integration-operation.repository';
import { IntegrationOperationOrmEntity } from './integration-operation.orm-entity';

const rank = (column: string) =>
  `(CASE ${column} WHEN 'pending' THEN 0 WHEN 'paid' THEN 1 WHEN 'disputed' THEN 2 WHEN 'refunded' THEN 3 ELSE -1 END)`;

@Injectable()
export class TypeOrmIntegrationOperationRepository extends IIntegrationOperationRepository {
  constructor(
    @InjectRepository(IntegrationOperationOrmEntity)
    private readonly repo: Repository<IntegrationOperationOrmEntity>,
  ) {
    super();
  }

  upsertFromNormalized(
    input: Parameters<
      IIntegrationOperationRepository['upsertFromNormalized']
    >[0],
  ): Promise<IntegrationOperation> {
    return runWithTenant(input.tenantId, async () => {
      const table = this.table();
      const rows: Array<Record<string, unknown>> = await this.repo.query(
        `INSERT INTO ${table} AS op
           (tenant_id, connection_id, provider, environment, external_account_id, operation_key, commercial_state, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (tenant_id, environment, provider, external_account_id, operation_key) DO UPDATE SET
           commercial_state = CASE
             WHEN op.commercial_state = 'canceled' THEN op.commercial_state
             WHEN EXCLUDED.commercial_state = 'canceled' THEN
               CASE WHEN op.commercial_state = 'pending' THEN 'canceled' ELSE op.commercial_state END
             WHEN ${rank('EXCLUDED.commercial_state')} > ${rank('op.commercial_state')} THEN EXCLUDED.commercial_state
             ELSE op.commercial_state END,
           snapshot = CASE
             WHEN ${rank('EXCLUDED.commercial_state')} > ${rank('op.commercial_state')}
               OR (${rank('EXCLUDED.commercial_state')} = ${rank('op.commercial_state')}
                   AND EXCLUDED.snapshot->>'occurredAt' > op.snapshot->>'occurredAt')
             THEN EXCLUDED.snapshot ELSE op.snapshot END,
           updated_at = now()
         RETURNING *`,
        [
          input.tenantId,
          input.connectionId,
          input.provider,
          input.environment,
          input.externalAccountId,
          input.normalized.operationKey,
          input.normalized.commercialState,
          JSON.stringify(input.normalized),
        ],
      );
      return this.fromRow(rows[0]);
    });
  }

  findById(id: string, tenantId: string): Promise<IntegrationOperation | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.repo.findOne({ where: { id, tenantId } });
      return row ? this.toDomain(row) : null;
    });
  }

  findByExternalRef(input: {
    tenantId: string;
    connectionId: string;
    ref: string;
    value: string;
  }): Promise<IntegrationOperation | null> {
    return runWithTenant(input.tenantId, async () => {
      const rows: Array<Record<string, unknown>> = await this.repo.query(
        `SELECT * FROM ${this.table()}
         WHERE tenant_id = $1 AND connection_id = $2
           AND snapshot #>> ARRAY['externalRefs', $3::text] = $4
         ORDER BY created_at DESC LIMIT 1`,
        [input.tenantId, input.connectionId, input.ref, input.value],
      );
      return rows.length > 0 ? this.fromRow(rows[0]) : null;
    });
  }

  listByConnection(
    connectionId: string,
    tenantId: string,
    limit: number,
  ): Promise<IntegrationOperation[]> {
    return runWithTenant(tenantId, async () =>
      (
        await this.repo.find({
          where: { connectionId, tenantId },
          order: { createdAt: 'DESC' },
          take: limit,
        })
      ).map((row) => this.toDomain(row)),
    );
  }

  freezeEmission(
    id: string,
    tenantId: string,
    emission: FrozenEmission,
  ): Promise<IntegrationOperation> {
    return runWithTenant(tenantId, async () => {
      await this.repo
        .createQueryBuilder()
        .update()
        .set({
          ruleId: emission.ruleId,
          emissionRequest: emission.request,
          emissionRequestHash: emission.requestHash,
          idempotencyKey: emission.idempotencyKey,
        } as QueryDeepPartialEntity<IntegrationOperationOrmEntity>)
        .where(
          'id = :id AND tenant_id = :tenantId AND emission_request IS NULL',
          {
            id,
            tenantId,
          },
        )
        .execute();
      const row = await this.repo.findOneOrFail({ where: { id, tenantId } });
      return this.toDomain(row);
    });
  }

  unfreezeEmission(id: string, tenantId: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      await this.repo.update(
        { id, tenantId },
        {
          ruleId: null,
          emissionRequest: null,
          emissionRequestHash: null,
          idempotencyKey: null,
        },
      );
    });
  }

  setFiscal(
    id: string,
    tenantId: string,
    status: FiscalStatus,
    blockReason: BlockReason | null,
    invoiceId?: string,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      await this.repo.update(
        { id, tenantId },
        {
          fiscalStatus: status,
          blockReason,
          ...(invoiceId ? { invoiceId } : {}),
        },
      );
    });
  }

  updateCustomer(
    id: string,
    tenantId: string,
    customer: NormalizedCustomer,
  ): Promise<IntegrationOperation | null> {
    return runWithTenant(tenantId, async () => {
      const result = await this.repo
        .createQueryBuilder()
        .update()
        .set({
          snapshot: () => `jsonb_set(snapshot, '{customer}', :customer::jsonb)`,
          fiscalStatus: 'none',
          blockReason: null,
        })
        .where(
          'id = :id AND tenant_id = :tenantId AND emission_request IS NULL',
          {
            id,
            tenantId,
          },
        )
        .setParameter('customer', JSON.stringify(customer))
        .execute();
      if (!result.affected) return null;
      const row = await this.repo.findOneOrFail({ where: { id, tenantId } });
      return this.toDomain(row);
    });
  }

  private table(): string {
    const { driver } = this.repo.manager.connection;
    return this.repo.metadata.tablePath
      .split('.')
      .map((part) => driver.escape(part))
      .join('.');
  }

  /** Raw rows from RETURNING * come back in snake_case. */
  private fromRow(row: Record<string, unknown>): IntegrationOperation {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      connectionId: row.connection_id as string,
      provider: row.provider as string,
      environment: row.environment as 'test' | 'live',
      externalAccountId: row.external_account_id as string,
      operationKey: row.operation_key as string,
      commercialState:
        row.commercial_state as IntegrationOperation['commercialState'],
      fiscalStatus: row.fiscal_status as FiscalStatus,
      blockReason: row.block_reason as BlockReason | null,
      snapshot: parseSnapshot(row.snapshot as Record<string, unknown>),
      ruleId: row.rule_id as string | null,
      emissionRequest: row.emission_request as Record<string, unknown> | null,
      emissionRequestHash: row.emission_request_hash as string | null,
      idempotencyKey: row.idempotency_key as string | null,
      invoiceId: row.invoice_id as string | null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  private toDomain(row: IntegrationOperationOrmEntity): IntegrationOperation {
    return {
      ...row,
      commercialState:
        row.commercialState as IntegrationOperation['commercialState'],
      fiscalStatus: row.fiscalStatus as FiscalStatus,
      blockReason: row.blockReason as BlockReason | null,
      snapshot: parseSnapshot(row.snapshot),
    };
  }
}
