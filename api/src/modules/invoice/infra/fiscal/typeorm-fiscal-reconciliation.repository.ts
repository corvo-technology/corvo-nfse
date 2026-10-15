import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type {
  IFiscalReconciliationRepository,
  NewReconciliationRow,
  ReconciliationRow,
} from '../../domain/fiscal/reconciliation/fiscal-reconciliation.repository';
import { InvoiceFiscalReconciliationOrmEntity } from './invoice-fiscal-reconciliation.orm-entity';
import { InvoiceFiscalSnapshotOrmEntity } from '../invoice-fiscal-snapshot.orm-entity';

@Injectable()
export class TypeOrmFiscalReconciliationRepository
  implements IFiscalReconciliationRepository
{
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private manager(): EntityManager {
    return this.transactions.getManager() ?? this.dataSource.manager;
  }

  private table(): string {
    return this.tableOf(InvoiceFiscalReconciliationOrmEntity);
  }

  private tableOf(entity: typeof InvoiceFiscalReconciliationOrmEntity | typeof InvoiceFiscalSnapshotOrmEntity): string {
    const metadata = this.dataSource.getMetadata(entity);
    const escape = (identifier: string) =>
      this.dataSource.driver.escape(identifier);
    return metadata.schema
      ? `${escape(metadata.schema)}.${escape(metadata.tableName)}`
      : escape(metadata.tableName);
  }

  private rowsOf(raw: unknown): ReconciliationRow[] {
    const list = raw as unknown[];
    return (Array.isArray(list[0]) ? list[0] : list).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record.id),
        invoiceId: String(record.invoice_id),
        tenantId: String(record.tenant_id),
        status: record.status as ReconciliationRow['status'],
        localValues: record.local_values as Record<string, string | null>,
        authorizedValues: record.authorized_values as Record<
          string,
          string | null
        >,
        differences: record.differences as ReconciliationRow['differences'],
        toleranceAbsolute: String(record.tolerance_absolute),
        rulesVersion: String(record.rules_version),
        reconciledAt: new Date(String(record.reconciled_at)),
      };
    });
  }

  /** Idempotent: the UNIQUE constraint on invoice_id makes redeliveries no-ops. */
  async insert(row: NewReconciliationRow): Promise<boolean> {
    return runWithTenant(row.tenantId, async () => {
      requireTenantId(row.tenantId);
      const rows = (await this.manager().query(
        `INSERT INTO ${this.table()} (invoice_id, tenant_id, status, local_values, authorized_values, differences, tolerance_absolute, rules_version, reconciled_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9)
         ON CONFLICT (invoice_id) DO NOTHING
         RETURNING id`,
        [
          row.invoiceId,
          row.tenantId,
          row.status,
          JSON.stringify(row.localValues),
          JSON.stringify(row.authorizedValues),
          JSON.stringify(row.differences),
          row.toleranceAbsolute,
          row.rulesVersion,
          row.reconciledAt,
        ],
      )) as unknown[];
      return rows.length > 0;
    });
  }

  async findByInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<ReconciliationRow | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const rows = await this.manager().query(
        `SELECT id, invoice_id, tenant_id, status, local_values, authorized_values, differences, tolerance_absolute, rules_version, reconciled_at
           FROM ${this.table()}
          WHERE invoice_id = $1 AND tenant_id = $2`,
        [invoiceId, tenantId],
      );
      const records = this.rowsOf(rows);
      return records[0] ?? null;
    });
  }

  async findAuthorizedWithoutReconciliation(
    tenantId: string,
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; companyId: string }>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const rows: unknown = await this.manager().query(
        `SELECT i.id, i.tenant_id, i.company_id
           FROM nfse_invoices i
          WHERE i.tenant_id = $1
            AND i.status = 'authorized'
            AND i.updated_at < $2
            AND EXISTS (
              SELECT 1 FROM ${this.tableOf(InvoiceFiscalSnapshotOrmEntity)} s
               WHERE s.invoice_id = i.id
                 AND s.tenant_id = i.tenant_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM ${this.table()} r
               WHERE r.invoice_id = i.id
            )
          ORDER BY i.updated_at
          LIMIT $3`,
        [tenantId, olderThan, limit],
      );
      const list = rows as unknown[];
      return (Array.isArray(list[0]) ? list[0] : list).map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: String(record.id),
          tenantId: String(record.tenant_id),
          companyId: String(record.company_id),
        };
      });
    });
  }
}
