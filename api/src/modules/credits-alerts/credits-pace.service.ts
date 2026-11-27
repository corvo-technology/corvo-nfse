import { Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
/** Below this much history the pace says nothing, and the forecast is left out. */
const MIN_INVOICES = 5;
const MIN_HISTORY_DAYS = 7;

/** How fast a workspace uses notes, from its live invoices. */
@Injectable()
export class CreditsPace {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  /** Live notes authorized per day over the last 30 days; null when there is not enough history. */
  perDay(tenantId: string, now = new Date()): Promise<number | null> {
    return runWithTenant(tenantId, async () => {
      const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
      const row = await this.db
        .repository(InvoiceOrmEntity)
        .createQueryBuilder('inv')
        .select('COUNT(*) FILTER (WHERE inv.authorized_at >= :since)', 'recent')
        .addSelect('MIN(inv.authorized_at)', 'first')
        .where('inv.tenant_id = :tenantId', { tenantId })
        .andWhere("inv.environment = 'live' AND inv.authorized_at IS NOT NULL")
        .setParameter('since', since)
        .getRawOne<{ recent: string; first: Date | string | null }>();
      const recent = Number(row?.recent ?? 0);
      if (!row?.first || recent < MIN_INVOICES) return null;
      const historyDays =
        (now.getTime() - new Date(row.first).getTime()) / DAY_MS;
      if (historyDays < MIN_HISTORY_DAYS) return null;
      return recent / Math.min(WINDOW_DAYS, historyDays);
    });
  }
}
