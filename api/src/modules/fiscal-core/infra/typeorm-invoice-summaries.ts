import { Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  CursorPage,
  encodeCursor,
  normalizeLimit,
} from '@/shared/http/pagination';
import { cursorScope, readKeysetCursor } from '@/shared/http/keyset-pagination';
import type { InvoiceType } from '../domain/invoice-type';

/** What `GET /v1/invoices?type=all` shows of each document, whatever its type. */
export interface InvoiceSummary {
  id: string;
  type: InvoiceType;
  companyId: string;
  environment: string;
  status: string;
  number: number | null;
  accessKey: string | null;
  amount: string | null;
  externalId: string | null;
  issuedAt: Date | null;
  createdAt: Date;
}

export interface InvoiceSummaryQuery {
  types: InvoiceType[];
  companyId?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

interface Row {
  id: string;
  type: InvoiceType;
  company_id: string;
  environment: string;
  status: string;
  number: string | null;
  access_key: string | null;
  amount: string | null;
  external_id: string | null;
  issued_at: Date | null;
  created_at: Date;
  pagination_sort: string;
}

/**
 * One list of NFS-e, NF-e and NFC-e together, newest first. Both tables are read in a single
 * `UNION ALL`, ordered by `(created_at, id)`: the cursor is the keyset of the last row shown, so
 * a page never repeats or skips a document of either type, whatever the mix.
 */
@Injectable()
export class TypeormInvoiceSummaries {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private table(name: string): string {
    const found = this.db
      .manager()
      .connection.entityMetadatas.find((meta) => meta.tableName === name);
    if (!found) throw new Error(`Table ${name} is not mapped`);
    return found.tablePath;
  }

  list(
    query: InvoiceSummaryQuery,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<CursorPage<InvoiceSummary>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const limit = normalizeLimit(query.limit);
      const scope = [
        'invoices-all',
        tenantId,
        environment,
        [...query.types].sort(),
        query.companyId,
        query.status,
      ];
      const cursor = readKeysetCursor(query.cursor, scope);
      const params: unknown[] = [tenantId, environment];
      const filters: string[] = [];
      if (query.companyId) {
        params.push(query.companyId);
        filters.push(`AND company_id = $${params.length}::uuid`);
      }
      if (query.status) {
        params.push(query.status);
        filters.push(`AND status = $${params.length}`);
      }
      const where = `WHERE tenant_id = $1 AND environment = $2 ${filters.join(' ')}`;
      const parts: string[] = [];
      if (query.types.includes('nfse'))
        parts.push(
          `SELECT id, 'nfse' AS type, company_id, environment, status, nfse_number::text AS number,
                  access_key, amount::text AS amount, external_id, issued_at, created_at
             FROM ${this.table('nfse_invoices')} ${where}`,
        );
      if (query.types.includes('nfe'))
        parts.push(
          `SELECT id, 'nfe' AS type, company_id, environment, status, number::text AS number,
                  access_key, totals->>'vNF' AS amount, external_id, issued_at, created_at
             FROM ${this.table('nfe_documents')} ${where} AND model = 55`,
        );
      if (query.types.includes('nfce'))
        parts.push(
          `SELECT id, 'nfce' AS type, company_id, environment, status, number::text AS number,
                  access_key, totals->>'vNF' AS amount, external_id, issued_at, created_at
             FROM ${this.table('nfe_documents')} ${where} AND model = 65`,
        );
      let after = '';
      if (cursor) {
        params.push(cursor.sort, cursor.id);
        after = `WHERE (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
      }
      params.push(limit + 1);
      const rows: Row[] = await this.db.manager().query(
        `SELECT *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS pagination_sort
           FROM (${parts.join(' UNION ALL ')}) u ${after}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length}`,
        params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return new CursorPage(
        page.map((row) => ({
          id: row.id,
          type: row.type,
          companyId: row.company_id,
          environment: row.environment,
          status: row.status,
          number: row.number === null ? null : Number(row.number),
          accessKey: row.access_key,
          amount: row.amount,
          externalId: row.external_id,
          issuedAt: row.issued_at,
          createdAt: row.created_at,
        })),
        {
          limit,
          hasMore,
          nextCursor:
            hasMore && last
              ? encodeCursor({
                  v: 1,
                  scope: cursorScope(scope),
                  sort: last.pagination_sort,
                  id: last.id,
                })
              : null,
        },
      );
    });
  }
}
