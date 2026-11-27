import { Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { CursorPage, type CursorQuery } from '@/shared/http/pagination';
import type { NfeInutilization } from '../domain/nfe-event';
import type { NfeInutilizationStatus } from '../domain/nfe-event-status';
import { NfeDocumentOrmEntity } from './nfe-document.orm-entity';
import { NfeInutilizationOrmEntity } from './nfe-inutilization.orm-entity';

function toInutilization(row: NfeInutilizationOrmEntity): NfeInutilization {
  return {
    id: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    environment: row.environment as ExecutionEnvironment,
    model: row.model === 65 ? 65 : 55,
    series: row.series,
    start: row.startNumber,
    end: row.endNumber,
    justification: row.justification,
    status: row.status as NfeInutilizationStatus,
    protocol: row.protocol,
    cStat: row.cStat,
    xMotivo: row.xMotivo,
    requestXml: row.requestXml,
    procXml: row.procXml,
    xmlPath: row.xmlPath,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface NewInutilization {
  id: string;
  tenantId: string;
  companyId: string;
  environment: ExecutionEnvironment;
  /** 55 (NF-e, the default) or 65 (NFC-e). */
  model?: 55 | 65;
  series: number;
  start: number;
  end: number;
  justification: string;
  requestXml: string;
  idempotencyKey: string | null;
  requestHash: string;
}

export interface InutilizationResult {
  protocol?: string | null;
  procXml?: string | null;
  cStat?: string | null;
  xMotivo?: string | null;
}

export interface ListInutilizationFilters {
  /** Only the inutilizations of this model; every model when absent. */
  model?: 55 | 65;
  companyId?: string;
  status?: NfeInutilizationStatus;
}

@Injectable()
export class TypeormNfeInutilizations {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private get rows() {
    return this.db.repository(NfeInutilizationOrmEntity);
  }

  insert(input: NewInutilization): Promise<void> {
    return runWithTenant(input.tenantId, async () => {
      requireTenantId(input.tenantId);
      await this.rows.insert({
        id: input.id,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        model: input.model ?? 55,
        series: input.series,
        startNumber: input.start,
        endNumber: input.end,
        justification: input.justification,
        requestXml: input.requestXml,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        status: 'pending',
      });
    });
  }

  find(id: string, tenantId: string): Promise<NfeInutilization | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.rows.findOne({ where: { id, tenantId } });
      return row ? toInutilization(row) : null;
    });
  }

  findByIdempotencyKey(
    key: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeInutilization | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.rows.findOne({
        where: { idempotencyKey: key, tenantId, environment },
      });
      return row ? toInutilization(row) : null;
    });
  }

  /** Newest first, as the other lists. */
  list(
    tenantId: string,
    environment: ExecutionEnvironment,
    query: CursorQuery & ListInutilizationFilters,
  ): Promise<CursorPage<NfeInutilization>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const builder = this.rows
        .createQueryBuilder('inut')
        .where(
          'inut.tenant_id = :tenantId AND inut.environment = :environment',
          {
            tenantId,
            environment,
          },
        );
      if (query.companyId)
        builder.andWhere('inut.company_id = :companyId', {
          companyId: query.companyId,
        });
      if (query.model)
        builder.andWhere('inut.model = :model', { model: query.model });
      if (query.status)
        builder.andWhere('inut.status = :status', { status: query.status });
      return queryCursorPage(
        builder,
        { limit: query.limit, cursor: query.cursor },
        [
          'nfe-inutilizations',
          tenantId,
          environment,
          query.companyId,
          query.status,
          query.model,
        ],
        toInutilization,
      );
    });
  }

  /**
   * An overlapping request that is waiting for the SEFAZ or was already approved (a rejected one
   * voided nothing).
   */
  async overlapping(
    tenantId: string,
    companyId: string,
    series: number,
    start: number,
    end: number,
    model: 55 | 65 = 55,
  ): Promise<NfeInutilization | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.rows
        .createQueryBuilder('inut')
        .where(
          `inut.tenant_id = :tenantId AND inut.company_id = :companyId AND inut.series = :series
           AND inut.model = :model AND inut.status IN ('pending','homologada')
           AND inut.start_number <= :end AND inut.end_number >= :start`,
          { tenantId, companyId, series, start, end, model },
        )
        .getOne();
      return row ? toInutilization(row) : null;
    });
  }

  /** A document of the company in the range that is not `discarded` (it used the number). */
  async documentsInRange(
    tenantId: string,
    companyId: string,
    series: number,
    start: number,
    end: number,
    model: 55 | 65 = 55,
  ): Promise<number> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.db
        .repository(NfeDocumentOrmEntity)
        .createQueryBuilder('doc')
        .where(
          `doc.tenant_id = :tenantId AND doc.company_id = :companyId AND doc.model = :model
           AND doc.series = :series AND doc.number BETWEEN :start AND :end
           AND doc.status <> 'discarded'`,
          { tenantId, companyId, series, start, end, model },
        )
        .getCount();
    });
  }

  /** Same idea as the events: move only from the expected state; true when this call moved it. */
  settle(
    id: string,
    tenantId: string,
    to: Exclude<NfeInutilizationStatus, 'pending'>,
    result: InutilizationResult,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const outcome = await this.rows
        .createQueryBuilder()
        .update()
        .set({ status: to, ...result, updatedAt: () => 'now()' })
        .where("id = :id AND tenant_id = :tenantId AND status = 'pending'", {
          id,
          tenantId,
        })
        .execute();
      return (outcome.affected ?? 0) > 0;
    });
  }

  /** Where the `procInutNFe` was stored: written once, never over a path already there. */
  markStored(id: string, tenantId: string, xmlPath: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.rows
        .createQueryBuilder()
        .update()
        .set({ xmlPath, updatedAt: () => 'now()' })
        .where('id = :id AND tenant_id = :tenantId AND xml_path IS NULL', {
          id,
          tenantId,
        })
        .execute();
    });
  }
}
