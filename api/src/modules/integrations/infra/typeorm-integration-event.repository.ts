import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  IIntegrationEventRepository,
  type ClaimedEvent,
  type EventResult,
  type IntegrationEventSummary,
  type NewIntegrationEvent,
} from '../domain/integration-event.repository';
import { IntegrationEventOrmEntity } from './integration-event.orm-entity';

@Injectable()
export class TypeOrmIntegrationEventRepository extends IIntegrationEventRepository {
  constructor(
    @InjectRepository(IntegrationEventOrmEntity)
    private readonly repo: Repository<IntegrationEventOrmEntity>,
  ) {
    super();
  }

  insertReceived(
    input: NewIntegrationEvent,
  ): Promise<{ id: string; created: boolean }> {
    return runWithTenant(input.tenantId, async () => {
      const result = await this.repo
        .createQueryBuilder()
        .insert()
        .values({
          ...input,
          lastError: input.lastError ?? null,
          attempts: 0,
          nextAttemptAt: () => 'now()',
        })
        .orIgnore()
        .returning('id')
        .execute();
      const rows = result.raw as Array<{ id: string }>;
      return rows.length > 0
        ? { id: rows[0].id, created: true }
        : { id: '', created: false };
    });
  }

  claimBatch(
    limit: number,
    leaseMs: number,
    now: Date,
  ): Promise<ClaimedEvent[]> {
    return runAsSystem('worker-discovery', async () => {
      const table = this.table();
      // For UPDATE ... RETURNING the driver answers [rows, affectedCount].
      const result: unknown = await this.repo.query(
        `WITH due AS (
           SELECT id FROM ${table}
           WHERE (state IN ('received', 'retry_pending') AND next_attempt_at <= $2)
              OR (state = 'processing' AND locked_until < $2)
           ORDER BY next_attempt_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE ${table} e
         SET state = 'processing', attempts = e.attempts + 1,
             claim_token = gen_random_uuid(), locked_until = $3, updated_at = now()
         FROM due WHERE e.id = due.id
         RETURNING e.id, e.tenant_id AS "tenantId", e.connection_id AS "connectionId",
                   e.provider, e.payload_enc AS "payloadEnc", e.attempts,
                   e.claim_token AS "claimToken"`,
        [limit, now, new Date(now.getTime() + leaseMs)],
      );
      return (result as [ClaimedEvent[], number])[0];
    });
  }

  markResult(
    claim: Pick<ClaimedEvent, 'id' | 'tenantId' | 'claimToken'>,
    result: EventResult,
  ): Promise<boolean> {
    return runWithTenant(claim.tenantId, async () => {
      const updated = await this.repo
        .createQueryBuilder()
        .update()
        .set({
          state: result.state,
          operationId: result.operationId ?? null,
          lastError: result.lastError ?? null,
          claimToken: null,
          lockedUntil: null,
          ...(result.nextAttemptAt
            ? { nextAttemptAt: result.nextAttemptAt }
            : {}),
        })
        .where('id = :id AND tenant_id = :tenantId AND claim_token = :token', {
          id: claim.id,
          tenantId: claim.tenantId,
          token: claim.claimToken,
        })
        .execute();
      return (updated.affected ?? 0) > 0;
    });
  }

  listByConnection(
    connectionId: string,
    tenantId: string,
    limit: number,
  ): Promise<IntegrationEventSummary[]> {
    return runWithTenant(tenantId, async () =>
      (
        await this.repo.find({
          where: { connectionId, tenantId },
          order: { createdAt: 'DESC' },
          take: limit,
        })
      ).map((row) => ({
        id: row.id,
        deliveryId: row.deliveryId,
        externalType: row.externalType,
        state: row.state as IntegrationEventSummary['state'],
        attempts: row.attempts,
        lastError: row.lastError,
        operationId: row.operationId,
        createdAt: row.createdAt,
      })),
    );
  }

  private table(): string {
    const { driver } = this.repo.manager.connection;
    return this.repo.metadata.tablePath
      .split('.')
      .map((part) => driver.escape(part))
      .join('.');
  }
}
