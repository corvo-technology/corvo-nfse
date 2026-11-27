import { Injectable } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import { PaymentIntentOrmEntity } from '@/modules/billing/infra/payment-intent.orm-entity';

export type MonthSummary = {
  count: number;
  totalCents: number;
  /** Customer names by total value, highest first. */
  topCustomers: string[];
  rejected: number;
  /** The company that issued the most notes, where the accountant is set. */
  mainCompany: { id: string; hasAccountant: boolean } | null;
};

export type PendingPurchase = {
  id: string;
  kind: 'plan' | 'avulso';
  units: number | null;
  createdAt: Date;
};

const TOP_CUSTOMERS = 3;

/** Read-only numbers for the lifecycle e-mails. Always called inside the workspace's scope. */
@Injectable()
export class LifecycleStatsRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private invoices() {
    return this.db.repository(InvoiceOrmEntity);
  }

  /** True when the workspace had a live invoice authorized before this one. */
  hasEarlierLiveAuthorization(
    tenantId: string,
    invoiceId: string,
    authorizedAt: Date,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      const earlier = await this.invoices()
        .createQueryBuilder('inv')
        .where('inv.tenant_id = :tenantId', { tenantId })
        .andWhere("inv.environment = 'live'")
        .andWhere('inv.id <> :invoiceId', { invoiceId })
        .andWhere('inv.authorized_at < :authorizedAt', { authorizedAt })
        .getCount();
      return earlier > 0;
    });
  }

  /** What the workspace issued in [start, end), live only. `count` 0 means nothing to report. */
  monthSummary(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<MonthSummary> {
    return runWithTenant(tenantId, async () => {
      const issued = () =>
        this.invoices()
          .createQueryBuilder('inv')
          .where('inv.tenant_id = :tenantId', { tenantId })
          .andWhere("inv.environment = 'live' AND inv.status = 'authorized'")
          .andWhere(
            'inv.authorized_at >= :start AND inv.authorized_at < :end',
            {
              start,
              end,
            },
          );
      const totals = await issued()
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(inv.amount), 0)', 'total')
        .getRawOne<{ count: string; total: string }>();
      const count = Number(totals?.count ?? 0);
      if (count === 0)
        return {
          count: 0,
          totalCents: 0,
          topCustomers: [],
          rejected: 0,
          mainCompany: null,
        };
      const customers = await issued()
        .select("inv.customer_snapshot ->> 'name'", 'name')
        .addSelect('SUM(inv.amount)', 'total')
        .andWhere("COALESCE(inv.customer_snapshot ->> 'name', '') <> ''")
        .andWhere("inv.customer_snapshot ->> 'taxId' IS NOT NULL")
        .groupBy("inv.customer_snapshot ->> 'name'")
        .orderBy('SUM(inv.amount)', 'DESC')
        .limit(TOP_CUSTOMERS)
        .getRawMany<{ name: string }>();
      const rejected = await this.invoices()
        .createQueryBuilder('inv')
        .where('inv.tenant_id = :tenantId', { tenantId })
        .andWhere("inv.environment = 'live' AND inv.status = 'rejected'")
        .andWhere('inv.created_at >= :start AND inv.created_at < :end', {
          start,
          end,
        })
        .getCount();
      const main = await issued()
        .select('inv.company_id', 'companyId')
        .groupBy('inv.company_id')
        .orderBy('COUNT(*)', 'DESC')
        .limit(1)
        .getRawOne<{ companyId: string }>();
      const company = main
        ? await this.db.repository(CompanyOrmEntity).findOne({
            where: { id: main.companyId, tenantId },
            select: { id: true, accountantEmail: true },
          })
        : null;
      return {
        count,
        totalCents: Math.round(Number(totals?.total ?? 0) * 100),
        topCustomers: customers.map((row) => row.name),
        rejected,
        mainCompany: company
          ? { id: company.id, hasAccountant: Boolean(company.accountantEmail) }
          : null,
      };
    });
  }

  /**
   * Checkouts started between `from` and `until` that were never paid, newest first.
   * A purchase is left out when the workspace paid something after it was started.
   */
  pendingPurchases(
    tenantId: string,
    from: Date,
    until: Date,
  ): Promise<PendingPurchase[]> {
    return runWithTenant(tenantId, async () => {
      const repo = this.db.repository(PaymentIntentOrmEntity);
      const rows = await repo
        .createQueryBuilder('pay')
        .where('pay.tenant_id = :tenantId', { tenantId })
        .andWhere("pay.status IN ('pending', 'expired')")
        .andWhere('pay.created_at >= :from AND pay.created_at <= :until', {
          from,
          until,
        })
        .orderBy('pay.created_at', 'DESC')
        .getMany();
      if (rows.length === 0) return [];
      const lastPaid = await repo.findOne({
        where: { tenantId, paidAt: Not(IsNull()) },
        order: { paidAt: 'DESC' },
        select: { id: true, paidAt: true },
      });
      return rows
        .filter((row) => !lastPaid?.paidAt || row.createdAt > lastPaid.paidAt)
        .map((row): PendingPurchase => ({
          id: row.id,
          kind: row.kind === 'avulso' ? 'avulso' : 'plan',
          units: row.units,
          createdAt: row.createdAt,
        }));
    });
  }
}
