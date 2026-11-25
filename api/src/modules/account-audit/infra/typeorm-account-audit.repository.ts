import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThan } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import type { CursorPage, CursorQuery } from '@/shared/http/pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type {
  AccountAuditEventView,
  AuditActorType,
  AuditEventFilters,
  NewAuditRow,
} from '../domain/account-audit';
import type { AccountAuditAction } from '../domain/account-audit-action';
import { IAccountAuditRepository } from '../domain/account-audit.repository';
import { AccountAuditEventOrmEntity } from './account-audit-event.orm-entity';

function toView(row: AccountAuditEventOrmEntity): AccountAuditEventView {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    environment: row.environment as 'test' | 'live' | null,
    actor: {
      type: row.actorType as AuditActorType,
      label: row.actorLabel,
      onBehalfOf: row.actorOnBehalfOfLabel,
    },
    action: row.action as AccountAuditAction,
    target: {
      type: row.targetType,
      id: row.targetId,
      label: row.targetLabel,
    },
    metadata: row.metadata,
  };
}

/**
 * Writes with the DataSource manager, never the ambient transaction manager: an
 * audit INSERT that fails must not abort the transaction of the audited action.
 */
@Injectable()
export class TypeOrmAccountAuditRepository extends IAccountAuditRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  private repo() {
    return this.dataSource.manager.getRepository(AccountAuditEventOrmEntity);
  }

  insert(row: NewAuditRow): Promise<void> {
    return runWithTenant(row.tenantId, async () => {
      await this.repo().insert({ ...row });
    });
  }

  listPage(
    tenantId: string,
    environment: ExecutionEnvironment,
    filters: AuditEventFilters,
    options: CursorQuery,
  ): Promise<CursorPage<AccountAuditEventView>> {
    return runWithTenant(tenantId, () => {
      const query = this.repo()
        .createQueryBuilder('audit')
        .where('audit.tenantId = :tenantId', { tenantId })
        .andWhere(
          '(audit.environment = :environment OR audit.environment IS NULL)',
          {
            environment,
          },
        );
      if (filters.actorType)
        query.andWhere('audit.actorType = :actorType', {
          actorType: filters.actorType,
        });
      if (filters.from)
        query.andWhere('audit.occurredAt >= :from', { from: filters.from });
      if (filters.to)
        query.andWhere('audit.occurredAt <= :to', { to: filters.to });
      return queryCursorPage(
        query,
        options,
        [
          'account-audit',
          tenantId,
          environment,
          filters.actorType ?? null,
          filters.from?.toISOString() ?? null,
          filters.to?.toISOString() ?? null,
        ],
        toView,
        { column: 'occurredAt' },
      );
    });
  }

  deleteOlderThan(tenantId: string, cutoff: Date): Promise<number> {
    return runWithTenant(tenantId, async () => {
      const result = await this.repo().delete({
        tenantId,
        occurredAt: LessThan(cutoff),
      });
      return result.affected ?? 0;
    });
  }
}
