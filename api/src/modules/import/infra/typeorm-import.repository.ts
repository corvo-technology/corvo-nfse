import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { LIMIT_CODES } from '../domain/import';
import type {
  ImportCounters,
  ImportRecord,
  ImportRow,
  ImportRowStatus,
  ImportStatus,
  NewImport,
  RowPage,
  RowPageQuery,
} from '../domain/import';
import { ImportRepository } from '../domain/import.repository';
import { ImportOrmEntity } from './import.orm-entity';
import { ImportRowOrmEntity } from './import-row.orm-entity';

const INSERT_CHUNK = 500;

const emptyCounters = (): ImportCounters => ({
  total: 0,
  valid: 0,
  invalid: 0,
  accepted: 0,
  authorized: 0,
  awaitingCredits: 0,
  validAmount: 0,
  awaitingAmount: 0,
  failed: 0,
  pending: 0,
  authorizedAmount: 0,
  pendingAmount: 0,
  failedAmount: 0,
});

function toRecord(row: ImportOrmEntity): ImportRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    environment: row.environment as ExecutionEnvironment,
    userId: row.userId,
    fileName: row.fileName,
    fileHash: row.fileHash,
    status: row.status as ImportStatus,
    companyId: row.companyId,
    errorCode: row.errorCode,
    rowsExpected: row.rowsExpected,
    unknownColumns: row.unknownColumns ?? [],
    emitStartedAt: row.emitStartedAt,
    emitFinishedAt: row.emitFinishedAt,
    createdAt: row.createdAt,
  };
}

function toRow(row: ImportRowOrmEntity): ImportRow {
  return {
    line: row.line,
    data: row.data,
    status: row.status as ImportRowStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    invoiceId: row.invoiceId,
  };
}

@Injectable()
export class TypeOrmImportRepository extends ImportRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {
    super();
  }

  private manager(): EntityManager {
    return this.transactions.getManager() ?? this.dataSource.manager;
  }

  private imports() {
    return this.manager().getRepository(ImportOrmEntity);
  }

  private rows() {
    return this.manager().getRepository(ImportRowOrmEntity);
  }

  create(input: NewImport): Promise<ImportRecord> {
    return runWithTenant(input.tenantId, async () => {
      await this.imports().insert(input);
      const saved = await this.imports().findOneByOrFail({
        id: input.id,
        tenantId: input.tenantId,
      });
      return toRecord(saved);
    });
  }

  findById(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): Promise<ImportRecord | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.imports().findOneBy({
        id,
        tenantId,
        environment: env,
      });
      return row ? toRecord(row) : null;
    });
  }

  async updateStatus(
    tenantId: string,
    id: string,
    patch: Parameters<ImportRepository['updateStatus']>[2],
  ): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.imports().update(
        { id, tenantId },
        patch as QueryDeepPartialEntity<ImportOrmEntity>,
      ),
    );
  }

  async insertRows(
    tenantId: string,
    importId: string,
    rows: ImportRow[],
  ): Promise<void> {
    await runWithTenant(tenantId, async () => {
      for (let i = 0; i < rows.length; i += INSERT_CHUNK)
        await this.rows().insert(
          rows.slice(i, i + INSERT_CHUNK).map((r) => ({
            ...r,
            tenantId,
            importId,
          })) as QueryDeepPartialEntity<ImportRowOrmEntity>[],
        );
    });
  }

  async deleteRows(tenantId: string, importId: string): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.rows().delete({ importId, tenantId }),
    );
  }

  private schema(): string {
    const options = this.dataSource.options;
    return this.dataSource.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async counters(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): Promise<ImportCounters> {
    return (
      (await this.countersMany(tenantId, env, [id])).get(id) ?? emptyCounters()
    );
  }

  countersMany(
    tenantId: string,
    env: ExecutionEnvironment,
    ids: string[],
  ): Promise<Map<string, ImportCounters>> {
    return runWithTenant(tenantId, async () => {
      const result = new Map<string, ImportCounters>(
        ids.map((id) => [id, emptyCounters()]),
      );
      if (ids.length === 0) return result;
      const schema = this.schema();
      const raw: Array<Record<string, number | string>> =
        await this.manager().query(
          `SELECT
           r.import_id AS id,
           count(*)::int AS total,
           count(*) FILTER (WHERE r.status = 'valid')::int AS valid,
           count(*) FILTER (WHERE r.status = 'invalid')::int AS invalid,
           count(*) FILTER (WHERE r.status = 'accepted')::int AS accepted,
           count(*) FILTER (WHERE r.status = 'accepted' AND i.status = 'authorized')::int AS authorized,
           count(*) FILTER (WHERE r.status = 'rejected' AND r.error_code = ANY($4))::int AS "awaitingCredits",
           COALESCE(SUM(CASE WHEN r.status = 'valid' THEN (r.data->>'amount')::numeric END), 0)::float8 AS "validAmount",
           COALESCE(SUM(CASE WHEN r.status = 'rejected' AND r.error_code = ANY($4) THEN (r.data->>'amount')::numeric END), 0)::float8 AS "awaitingAmount",
           count(*) FILTER (WHERE r.status = 'invalid'
             OR (r.status = 'rejected' AND NOT (COALESCE(r.error_code, '') = ANY($4)))
             OR (r.status = 'accepted' AND i.status IN ('rejected','failed','manual_review')))::int AS failed,
           count(*) FILTER (WHERE r.status IN ('valid','queued')
             OR (r.status = 'accepted' AND i.status IN ('queued','processing','retry_pending','reconciliation_required')))::int AS pending,
           COALESCE(SUM(CASE WHEN r.status = 'accepted' AND i.status = 'authorized' THEN (r.data->>'amount')::numeric END), 0)::float8 AS "authorizedAmount",
           COALESCE(SUM(CASE WHEN r.status IN ('valid','queued')
             OR (r.status = 'accepted' AND i.status IN ('queued','processing','retry_pending','reconciliation_required'))
             THEN (r.data->>'amount')::numeric END), 0)::float8 AS "pendingAmount",
           COALESCE(SUM(CASE WHEN (r.status = 'rejected' AND NOT (COALESCE(r.error_code, '') = ANY($4)))
             OR (r.status = 'accepted' AND i.status IN ('rejected','failed','manual_review'))
             THEN (r.data->>'amount')::numeric END), 0)::float8 AS "failedAmount"
         FROM ${schema}.import_rows r
         JOIN ${schema}.imports m ON m.id = r.import_id
         LEFT JOIN ${schema}.nfse_invoices i ON i.id = r.invoice_id
         WHERE r.import_id = ANY($1) AND m.tenant_id = $2 AND m.environment = $3
         GROUP BY r.import_id`,
          [ids, tenantId, env, LIMIT_CODES],
        );
      for (const { id, ...counts } of raw)
        result.set(String(id), counts as unknown as ImportCounters);
      return result;
    });
  }

  listRecent(
    tenantId: string,
    env: ExecutionEnvironment,
    limit: number,
  ): Promise<ImportRecord[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.imports().find({
        where: { tenantId, environment: env },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: limit,
      });
      return rows.map(toRecord);
    });
  }

  listFailedInvoices(
    tenantId: string,
    env: ExecutionEnvironment,
    importId: string,
    query: { cursor?: string; limit: number },
  ): Promise<RowPage> {
    return runWithTenant(tenantId, async () => {
      const schema = this.schema();
      const found: Array<{
        line: number;
        data: Record<string, unknown>;
        invoice_id: string;
        code: string | null;
        message: string | null;
      }> = await this.manager().query(
        `SELECT r.line, r.data, r.invoice_id, i.last_error_code AS code, i.last_error_message AS message
           FROM ${schema}.import_rows r
           JOIN ${schema}.imports m ON m.id = r.import_id
           JOIN ${schema}.nfse_invoices i ON i.id = r.invoice_id
          WHERE r.import_id = $1 AND m.tenant_id = $2 AND m.environment = $3
            AND r.status = 'accepted' AND i.status IN ('rejected','failed','manual_review')
            AND r.line > $4
          ORDER BY r.line LIMIT $5`,
        [
          importId,
          tenantId,
          env,
          query.cursor ? Number(query.cursor) : 0,
          query.limit + 1,
        ],
      );
      const items: ImportRow[] = found.slice(0, query.limit).map((r) => ({
        line: r.line,
        data: r.data,
        status: 'accepted',
        errorCode: r.code,
        errorMessage: r.message,
        invoiceId: r.invoice_id,
      }));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          found.length > query.limit && last ? String(last.line) : null,
      };
    });
  }

  listRows(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
    query: RowPageQuery,
  ): Promise<RowPage> {
    return runWithTenant(tenantId, async () => {
      const qb = this.rows()
        .createQueryBuilder('r')
        .innerJoin(ImportOrmEntity, 'm', 'm.id = r.import_id')
        .where(
          'r.import_id = :id AND m.tenant_id = :tenantId AND m.environment = :env',
          { id, tenantId, env },
        )
        .orderBy('r.line', 'ASC')
        .take(query.limit + 1);
      if (query.status)
        qb.andWhere('r.status = :status', { status: query.status });
      if (query.cursor)
        qb.andWhere('r.line > :cursor', { cursor: Number(query.cursor) });
      const found = await qb.getMany();
      const items = found.slice(0, query.limit).map(toRow);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          found.length > query.limit && last ? String(last.line) : null,
      };
    });
  }

  async claimEmit(tenantId: string, importId: string): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      const out = await this.imports()
        .createQueryBuilder()
        .update()
        .set({
          status: 'emitting',
          emitFinishedAt: null,
          emitStartedAt: () => 'COALESCE(emit_started_at, now())',
        })
        .where(
          "id = :importId AND tenant_id = :tenantId AND status IN ('ready','done')",
          { importId, tenantId },
        )
        .execute();
      return (out.affected ?? 0) > 0;
    });
  }

  async markRowsQueued(
    tenantId: string,
    importId: string,
    retryCodes: string[],
  ): Promise<number> {
    return runWithTenant(tenantId, async () => {
      await this.rows()
        .createQueryBuilder()
        .update()
        .set({ status: 'queued', errorCode: null, errorMessage: null })
        .where(
          "import_id = :importId AND tenant_id = :tenantId AND (status IN ('valid','queued') OR (status = 'rejected' AND error_code IN (:...retryCodes)))",
          { importId, tenantId, retryCodes },
        )
        .execute();
      return this.rows().countBy({ importId, tenantId, status: 'queued' });
    });
  }

  async rejectQueued(
    tenantId: string,
    importId: string,
    error: { code: string; message: string },
  ): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.rows()
        .createQueryBuilder()
        .update()
        .set({
          status: 'rejected',
          errorCode: error.code,
          errorMessage: error.message,
        })
        .where(
          "import_id = :importId AND tenant_id = :tenantId AND status = 'queued'",
          { importId, tenantId },
        )
        .execute(),
    );
  }

  async markDone(tenantId: string, importId: string): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      const schema = this.schema();
      const out = await this.imports()
        .createQueryBuilder()
        .update()
        .set({ status: 'done', emitFinishedAt: () => 'now()' })
        .where(
          `id = :importId AND tenant_id = :tenantId AND status = 'emitting'
           AND NOT EXISTS (SELECT 1 FROM ${schema}.import_rows r WHERE r.import_id = :importId AND r.status = 'queued')`,
          { importId, tenantId },
        )
        .execute();
      return (out.affected ?? 0) > 0;
    });
  }

  async updateEditableRow(
    tenantId: string,
    importId: string,
    line: number,
    patch: Partial<Omit<ImportRow, 'line'>>,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      const schema = this.schema();
      const out = await this.rows()
        .createQueryBuilder()
        .update()
        .set(patch as QueryDeepPartialEntity<ImportRowOrmEntity>)
        .where(
          `import_id = :importId AND line = :line AND tenant_id = :tenantId AND status IN ('valid','invalid')
           AND EXISTS (SELECT 1 FROM ${schema}.imports m WHERE m.id = :importId AND m.status = 'ready')`,
          { importId, line, tenantId },
        )
        .execute();
      return (out.affected ?? 0) > 0;
    });
  }

  findRow(
    tenantId: string,
    env: ExecutionEnvironment,
    importId: string,
    line: number,
  ): Promise<ImportRow | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.rows()
        .createQueryBuilder('r')
        .innerJoin(ImportOrmEntity, 'm', 'm.id = r.import_id')
        .where(
          'r.import_id = :importId AND r.line = :line AND m.tenant_id = :tenantId AND m.environment = :env',
          { importId, line, tenantId, env },
        )
        .getOne();
      return row ? toRow(row) : null;
    });
  }

  async updateRow(
    tenantId: string,
    importId: string,
    line: number,
    patch: Partial<Omit<ImportRow, 'line'>>,
  ): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.rows().update(
        { importId, line, tenantId },
        patch as QueryDeepPartialEntity<ImportRowOrmEntity>,
      ),
    );
  }

  findByFileHash(
    tenantId: string,
    env: ExecutionEnvironment,
    companyId: string | null,
    fileHash: string,
  ): Promise<ImportRecord | null> {
    return runWithTenant(tenantId, async () => {
      const qb = this.imports()
        .createQueryBuilder('m')
        .where(
          'm.tenant_id = :tenantId AND m.environment = :env AND m.file_hash = :fileHash',
          { tenantId, env, fileHash },
        )
        .orderBy('m.created_at', 'DESC');
      if (companyId) qb.andWhere('m.company_id = :companyId', { companyId });
      else qb.andWhere('m.company_id IS NULL');
      const row = await qb.getOne();
      return row ? toRecord(row) : null;
    });
  }

  async deleteOlderThan(days: number): Promise<number> {
    return runAsSystem('import-housekeeping', async () => {
      const out = await this.imports()
        .createQueryBuilder()
        .delete()
        .where('created_at < now() - make_interval(days => :days)', { days })
        .execute();
      return out.affected ?? 0;
    });
  }

  async deleteIfStatus(
    tenantId: string,
    id: string,
    statuses: ImportStatus[],
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      const out = await this.imports()
        .createQueryBuilder()
        .delete()
        .where(
          'id = :id AND tenant_id = :tenantId AND status IN (:...statuses)',
          {
            id,
            tenantId,
            statuses,
          },
        )
        .execute();
      return (out.affected ?? 0) > 0;
    });
  }

  async failStuck(hours: number): Promise<number> {
    return runAsSystem('import-housekeeping', async () => {
      const out = await this.imports()
        .createQueryBuilder()
        .update()
        .set({ status: 'failed', errorCode: 'ERROR_IMPORT_UNREADABLE' })
        .where(
          "status = 'processing' AND created_at < now() - make_interval(hours => :hours)",
          { hours },
        )
        .execute();
      return out.affected ?? 0;
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await runWithTenant(tenantId, () =>
      this.imports().delete({ id, tenantId }),
    );
  }
}
