import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { Decimal } from '@/shared/types/money';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  IInvoicePackageRepository,
  monthRange,
  type PackageInvoice,
  type PackageScope,
} from '../domain/invoice-package.repository';
import { InvoiceFiscalSnapshotOrmEntity } from './invoice-fiscal-snapshot.orm-entity';
import { InvoiceOrmEntity } from './invoice.orm-entity';

@Injectable()
export class TypeOrmInvoicePackageRepository implements IInvoicePackageRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private query(scope: PackageScope) {
    const { start, end } = monthRange(scope.month);
    return this.db
      .repository(InvoiceOrmEntity)
      .createQueryBuilder('invoice')
      .where('invoice.tenant_id = :tenantId', { tenantId: scope.tenantId })
      .andWhere('invoice.company_id = :companyId', {
        companyId: scope.companyId,
      })
      .andWhere('invoice.environment = :environment', {
        environment: scope.environment,
      })
      .andWhere("invoice.status IN ('authorized', 'cancelled')")
      .andWhere('invoice.competence_date >= :start', { start })
      .andWhere('invoice.competence_date < :end', { end });
  }

  summarize(scope: PackageScope): Promise<{ count: number; total: string }> {
    return runWithTenant(scope.tenantId, async () => {
      const raw = await this.query(scope)
        .select('COUNT(*)', 'count')
        .addSelect(
          "COALESCE(SUM(invoice.amount) FILTER (WHERE invoice.status = 'authorized'), 0)",
          'total',
        )
        .getRawOne<{ count: string; total: string }>();
      return {
        count: Number(raw?.count ?? 0),
        total: new Decimal(raw?.total ?? 0).toFixed(2),
      };
    });
  }

  list(scope: PackageScope, limit: number): Promise<PackageInvoice[]> {
    return runWithTenant(scope.tenantId, async () => {
      const invoices = await this.query(scope)
        .orderBy('invoice.nfse_number', 'ASC')
        .addOrderBy('invoice.id', 'ASC')
        .limit(limit)
        .getMany();
      const snapshots = invoices.length
        ? await this.db.repository(InvoiceFiscalSnapshotOrmEntity).find({
            where: {
              tenantId: scope.tenantId,
              invoiceId: In(invoices.map((invoice) => invoice.id)),
            },
            order: { attempt: 'ASC' },
          })
        : [];
      // Attempts come in order: the last one of each invoice is the calculation that was issued.
      const latest = new Map<string, InvoiceFiscalSnapshotOrmEntity>();
      for (const snapshot of snapshots)
        latest.set(snapshot.invoiceId, snapshot);
      return invoices.map((invoice) => {
        const fiscal = latest.get(invoice.id);
        const customer = invoice.customerSnapshot as {
          taxId?: string;
          name?: string;
        };
        const service = invoice.serviceSnapshot as {
          code?: string;
          description?: string;
        };
        return {
          id: invoice.id,
          tenantId: invoice.tenantId,
          environment: invoice.environment as ExecutionEnvironment,
          documentKeyVersion: invoice.documentKeyVersion,
          documentsReady: Boolean(invoice.documentsReadyAt),
          summary: {
            number:
              invoice.nfseNumber != null ? String(invoice.nfseNumber) : null,
            issuedAt: invoice.authorizedAt ?? null,
            competenceDate: invoice.competenceDate,
            cancelled: invoice.status === 'cancelled',
            customerTaxId: customer.taxId,
            customerName: customer.name,
            serviceCode: service.code,
            description: service.description,
            gross: fiscal?.grossAmount ?? String(invoice.amount),
            discount: fiscal?.discountAmount,
            iss: fiscal?.issAmount,
            net: fiscal?.netReceivableAmount,
            accessKey: invoice.accessKey,
          },
        };
      });
    });
  }
}
