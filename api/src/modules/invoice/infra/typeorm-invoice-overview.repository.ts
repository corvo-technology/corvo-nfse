import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { Invoice } from '../domain/invoice';
import type {
  IInvoiceOverviewRepository,
  OverviewRange,
  OverviewRecent,
} from '../domain/invoice-overview.repository';
import { InvoiceOrmEntity } from './invoice.orm-entity';
import { InvoiceMapper } from './invoice.mapper';

interface RecentRow {
  id: string;
  type: 'nfse' | 'nfe' | 'nfce';
  company_id: string;
  environment: string;
  status: string;
  number: string | null;
  access_key: string | null;
  amount: string | null;
  external_id: string | null;
  recipient_name: string | null;
  authorized_at: Date | null;
  created_at: Date;
}

/**
 * The overview of every kind of note: NFS-e (`nfse_invoices`) and NF-e/NFC-e (`nfe_documents`,
 * model 55/65) are read together with one `UNION ALL`. Statuses fall in the same three groups:
 * `denied` counts as rejected, `queued` and `processing` as processing.
 */
@Injectable()
export class TypeOrmInvoiceOverviewRepository implements IInvoiceOverviewRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private table(name: string): string {
    const found = this.db
      .manager()
      .connection.entityMetadatas.find((meta) => meta.tableName === name);
    if (!found) throw new Error(`Table ${name} is not mapped`);
    return found.tablePath;
  }

  read(
    tenantId: string,
    environment: ExecutionEnvironment,
    range: OverviewRange,
  ) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const nfse = this.table('nfse_invoices');
      const nfe = this.table('nfe_documents');
      const where = 'WHERE tenant_id = $1 AND environment = $2';
      const notes = `(
        SELECT id, 'nfse' AS type, company_id, environment, status, nfse_number::text AS number,
               access_key, amount::text AS amount, external_id, NULL::text AS recipient_name,
               authorized_at, created_at
          FROM ${nfse} ${where}
        UNION ALL
        SELECT id, CASE model WHEN 65 THEN 'nfce' ELSE 'nfe' END, company_id, environment, status,
               number::text, access_key, totals->>'vNF', external_id, recipient->>'name',
               authorized_at, created_at
          FROM ${nfe} ${where} AND status <> 'discarded'
      ) notes`;
      const manager = this.db.manager();

      const [counts, dailyActivity, recent] = await Promise.all([
        manager.query<
          { authorized: string; rejected: string; processing: string }[]
        >(
          `SELECT COUNT(*) FILTER (WHERE status = 'authorized') AS authorized,
                  COUNT(*) FILTER (WHERE status IN ('rejected', 'denied')) AS rejected,
                  COUNT(*) FILTER (WHERE status IN ('queued', 'processing')) AS processing
             FROM ${notes} WHERE created_at >= $3 AND created_at < $4`,
          [tenantId, environment, range.start, range.end],
        ),
        manager.query<{ date: string; count: string }[]>(
          `SELECT TO_CHAR(authorized_at AT TIME ZONE $5, 'YYYY-MM-DD') AS date, COUNT(*) AS count
             FROM ${notes}
            WHERE status = 'authorized' AND authorized_at >= $3 AND authorized_at < $4
            GROUP BY 1 ORDER BY 1 ASC`,
          [tenantId, environment, range.start, range.end, range.timezone],
        ),
        manager.query<RecentRow[]>(
          `SELECT * FROM ${notes} WHERE created_at >= $3 AND created_at < $4
            ORDER BY created_at DESC, id DESC LIMIT 5`,
          [tenantId, environment, range.start, range.end],
        ),
      ]);

      const nfseIds = recent.filter((r) => r.type === 'nfse').map((r) => r.id);
      const mapper = new InvoiceMapper();
      const invoices = new Map<string, Invoice>(
        nfseIds.length === 0
          ? []
          : (
              await this.db
                .repository(InvoiceOrmEntity)
                .find({ where: { id: In(nfseIds), tenantId } })
            ).map((row) => [row.id, mapper.toDomain(row)]),
      );
      const recentInvoices: OverviewRecent[] = [];
      for (const row of recent) {
        if (row.type === 'nfse') {
          const invoice = invoices.get(row.id);
          if (invoice) recentInvoices.push(invoice);
          continue;
        }
        recentInvoices.push({
          id: row.id,
          type: row.type,
          companyId: row.company_id,
          environment: row.environment,
          status: row.status,
          number: row.number === null ? null : Number(row.number),
          accessKey: row.access_key,
          amount: row.amount,
          recipientName: row.recipient_name,
          externalId: row.external_id,
          authorizedAt: row.authorized_at,
          createdAt: row.created_at,
        });
      }
      const count = counts[0];
      return {
        counts: {
          authorized: Number(count?.authorized ?? 0),
          rejected: Number(count?.rejected ?? 0),
          processing: Number(count?.processing ?? 0),
        },
        dailyActivity: dailyActivity.map((day) => ({
          date: day.date,
          count: Number(day.count),
        })),
        recentInvoices,
      };
    });
  }
}
