import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
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
import { InvoiceOrmEntity } from '../invoice.orm-entity';

@Injectable()
export class TypeOrmFiscalReconciliationRepository implements IFiscalReconciliationRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private manager(): EntityManager {
    return this.transactions.getManager() ?? this.dataSource.manager;
  }

  /** Idempotent: the UNIQUE constraint on invoice_id makes redeliveries no-ops. */
  async insert(row: NewReconciliationRow): Promise<boolean> {
    return runWithTenant(row.tenantId, async () => {
      requireTenantId(row.tenantId);
      const result = await this.manager()
        .createQueryBuilder()
        .insert()
        .into(InvoiceFiscalReconciliationOrmEntity)
        .values(row)
        .orIgnore()
        .returning('id')
        .execute();
      return (result.raw as unknown[]).length > 0;
    });
  }

  async findByInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<ReconciliationRow | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const found = await this.manager()
        .getRepository(InvoiceFiscalReconciliationOrmEntity)
        .findOneBy({ invoiceId, tenantId });
      return (found as ReconciliationRow | null) ?? null;
    });
  }

  async findAuthorizedWithoutReconciliation(
    tenantId: string,
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; companyId: string }>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const invoices = await this.authorizedWithoutReconciliation(
        tenantId,
        olderThan,
        limit,
      ).getMany();
      return invoices.map(({ id, tenantId, companyId }) => ({
        id,
        tenantId,
        companyId,
      }));
    });
  }

  /**
   * Authorized invoices that have a fiscal snapshot and no reconciliation yet.
   * Built with the query builder so TypeORM qualifies every table with the
   * configured schema: the connection has no search_path.
   */
  authorizedWithoutReconciliation(
    tenantId: string,
    olderThan: Date,
    limit: number,
  ): SelectQueryBuilder<InvoiceOrmEntity> {
    return this.manager()
      .getRepository(InvoiceOrmEntity)
      .createQueryBuilder('invoice')
      .select(['invoice.id', 'invoice.tenantId', 'invoice.companyId'])
      .where('invoice.tenantId = :tenantId', { tenantId })
      .andWhere('invoice.status = :status', { status: 'authorized' })
      .andWhere('invoice.updatedAt < :olderThan', { olderThan })
      .andWhere(
        (qb) =>
          `EXISTS ${qb
            .subQuery()
            .select('1')
            .from(InvoiceFiscalSnapshotOrmEntity, 'snapshot')
            .where('snapshot.invoiceId = invoice.id')
            .andWhere('snapshot.tenantId = invoice.tenantId')
            .getQuery()}`,
      )
      .andWhere(
        (qb) =>
          `NOT EXISTS ${qb
            .subQuery()
            .select('1')
            .from(InvoiceFiscalReconciliationOrmEntity, 'reconciliation')
            .where('reconciliation.invoiceId = invoice.id')
            .getQuery()}`,
      )
      .orderBy('invoice.updatedAt', 'ASC')
      .limit(limit);
  }
}
