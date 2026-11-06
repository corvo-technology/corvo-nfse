import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, type FindOptionsWhere } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import {
  InvoiceSchedule,
  type InvoiceScheduleProps,
} from '../domain/invoice-schedule';
import {
  InvoiceScheduleRepository,
  type NewScheduleRun,
  type ScheduleListFilter,
  type ScheduleListResult,
  type SchedulePage,
  type ScheduleRun,
} from '../domain/invoice-schedule.repository';
import { InvoiceScheduleOrmEntity } from './invoice-schedule.orm-entity';
import { InvoiceScheduleRunOrmEntity } from './invoice-schedule-run.orm-entity';

function toProps(row: InvoiceScheduleOrmEntity): InvoiceScheduleProps {
  return {
    id: row.id,
    tenantId: row.tenantId,
    environment: row.environment as InvoiceScheduleProps['environment'],
    companyId: row.companyId,
    kind: row.kind as InvoiceScheduleProps['kind'],
    frequency: row.frequency as InvoiceScheduleProps['frequency'],
    anchorOn: row.anchorOn,
    endsOn: row.endsOn,
    invoiceInput: row.invoiceInput,
    status: row.status as InvoiceScheduleProps['status'],
    pauseReason: row.pauseReason as InvoiceScheduleProps['pauseReason'],
    occurrenceIndex: row.occurrenceIndex,
    nextRunOn: row.nextRunOn,
    attempts: row.attempts,
    lastRunOn: row.lastRunOn,
    createdBy: row.createdBy,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** jsonb columns defeat TypeORM's deep-partial typing; the shape is the entity's own. */
function toRow(
  props: Readonly<InvoiceScheduleProps>,
): QueryDeepPartialEntity<InvoiceScheduleOrmEntity> {
  return {
    ...props,
  } as unknown as QueryDeepPartialEntity<InvoiceScheduleOrmEntity>;
}

@Injectable()
export class TypeOrmInvoiceScheduleRepository extends InvoiceScheduleRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {
    super();
  }

  /** The caller's open transaction when there is one (claim and writes share it). */
  private manager(): EntityManager {
    return this.transactions.getManager() ?? this.dataSource.manager;
  }

  private schedules() {
    return this.manager().getRepository(InvoiceScheduleOrmEntity);
  }

  async insert(schedule: InvoiceSchedule): Promise<void> {
    const { tenantId } = schedule.props;
    await runWithTenant(tenantId, () =>
      this.schedules().insert(toRow(schedule.props)),
    );
  }

  findById(
    id: string,
    tenantId: string,
    options?: { forUpdate?: boolean },
  ): Promise<InvoiceSchedule | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.schedules().findOne({
        where: { id, tenantId },
        ...(options?.forUpdate
          ? { lock: { mode: 'pessimistic_write' as const } }
          : {}),
      });
      return row ? InvoiceSchedule.restore(toProps(row)) : null;
    });
  }

  findByIdempotencyKey(
    tenantId: string,
    environment: 'test' | 'live',
    key: string,
  ): Promise<InvoiceSchedule | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.schedules().findOneBy({
        tenantId,
        environment,
        idempotencyKey: key,
      });
      return row ? InvoiceSchedule.restore(toProps(row)) : null;
    });
  }

  list(
    tenantId: string,
    filter: ScheduleListFilter,
    page: SchedulePage,
  ): Promise<ScheduleListResult<InvoiceSchedule>> {
    return runWithTenant(tenantId, async () => {
      const where: FindOptionsWhere<InvoiceScheduleOrmEntity> = { tenantId };
      if (filter.status) where.status = filter.status;
      if (filter.companyId) where.companyId = filter.companyId;
      if (filter.environment) where.environment = filter.environment;
      const [rows, total] = await this.schedules().findAndCount({
        where,
        order: { createdAt: 'DESC', id: 'DESC' },
        take: page.limit,
        skip: page.offset,
      });
      return {
        items: rows.map((row) => InvoiceSchedule.restore(toProps(row))),
        total,
      };
    });
  }

  async save(schedule: InvoiceSchedule): Promise<void> {
    const { id, tenantId, ...rest } = schedule.props;
    await runWithTenant(tenantId, () =>
      this.schedules().update({ id, tenantId }, toRow(rest as never)),
    );
  }

  countActive(tenantId: string): Promise<number> {
    return runWithTenant(tenantId, () =>
      this.schedules().countBy({ tenantId, status: 'active' }),
    );
  }

  async listDueTenantIds(
    today: string,
    limit: number,
    afterTenantId?: string,
  ): Promise<string[]> {
    const rows = await runAsSystem('invoice-schedule-runner', () => {
      const query = this.schedules()
        .createQueryBuilder('s')
        .select('s.tenant_id', 'tenantId')
        .distinct(true)
        .where("s.status = 'active'")
        .andWhere('s.next_run_on <= :today', { today });
      if (afterTenantId)
        query.andWhere('s.tenant_id > :afterTenantId', { afterTenantId });
      return query
        .orderBy('s.tenant_id')
        .limit(limit)
        .getRawMany<{ tenantId: string }>();
    });
    return rows.map((row) => row.tenantId);
  }

  claimDueForTenant(
    tenantId: string,
    today: string,
    limit: number,
  ): Promise<InvoiceSchedule[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.schedules()
        .createQueryBuilder('s')
        .where('s.tenant_id = :tenantId', { tenantId })
        .andWhere("s.status = 'active'")
        .andWhere('s.next_run_on <= :today', { today })
        .orderBy('s.next_run_on', 'ASC')
        .addOrderBy('s.created_at', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      return rows.map((row) => InvoiceSchedule.restore(toProps(row)));
    });
  }

  async addRun(run: NewScheduleRun): Promise<void> {
    await runWithTenant(run.tenantId, () =>
      // A copy: TypeORM writes the generated id back onto the object it inserts.
      this.manager()
        .getRepository(InvoiceScheduleRunOrmEntity)
        .insert({ ...run }),
    );
  }

  nextAttempt(
    scheduleId: string,
    tenantId: string,
    occurrenceOn: string,
  ): Promise<number> {
    return runWithTenant(tenantId, async () => {
      const row = await this.manager()
        .getRepository(InvoiceScheduleRunOrmEntity)
        .createQueryBuilder('r')
        .select('MAX(r.attempt)', 'max')
        .where('r.schedule_id = :scheduleId', { scheduleId })
        .andWhere('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.occurrence_on = :occurrenceOn', { occurrenceOn })
        .getRawOne<{ max: number | null }>();
      return Number(row?.max ?? 0) + 1;
    });
  }

  listRuns(
    scheduleId: string,
    tenantId: string,
    page: SchedulePage,
  ): Promise<ScheduleListResult<ScheduleRun>> {
    return runWithTenant(tenantId, async () => {
      const [rows, total] = await this.manager()
        .getRepository(InvoiceScheduleRunOrmEntity)
        .findAndCount({
          where: { scheduleId, tenantId },
          order: { createdAt: 'DESC', id: 'DESC' },
          take: page.limit,
          skip: page.offset,
        });
      return {
        items: rows.map((row) => ({
          ...row,
          outcome: row.outcome as ScheduleRun['outcome'],
        })),
        total,
      };
    });
  }
}
