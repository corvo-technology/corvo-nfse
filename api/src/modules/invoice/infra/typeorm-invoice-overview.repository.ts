import { Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type {
  IInvoiceOverviewRepository,
  OverviewRange,
} from '../domain/invoice-overview.repository';
import { InvoiceOrmEntity } from './invoice.orm-entity';
import { InvoiceMapper } from './invoice.mapper';

@Injectable()
export class TypeOrmInvoiceOverviewRepository implements IInvoiceOverviewRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  read(
    tenantId: string,
    environment: ExecutionEnvironment,
    range: OverviewRange,
  ) {
    return runWithTenant(tenantId, async () => {
      const base = () =>
        this.db
          .repository(InvoiceOrmEntity)
          .createQueryBuilder('invoice')
          .where('invoice.tenant_id = :tenantId', { tenantId })
          .andWhere('invoice.environment = :environment', { environment });
      const created = () =>
        base().andWhere(
          'invoice.created_at >= :start AND invoice.created_at < :end',
          range,
        );

      const [counts, dailyActivity, recent] = await Promise.all([
        created()
          .select(
            "COUNT(*) FILTER (WHERE invoice.status = 'authorized')",
            'authorized',
          )
          .addSelect(
            "COUNT(*) FILTER (WHERE invoice.status = 'rejected')",
            'rejected',
          )
          .addSelect(
            "COUNT(*) FILTER (WHERE invoice.status IN ('queued', 'processing'))",
            'processing',
          )
          .getRawOne<{
            authorized: string;
            rejected: string;
            processing: string;
          }>(),
        base()
          .select(
            "TO_CHAR(invoice.authorized_at AT TIME ZONE :timezone, 'YYYY-MM-DD')",
            'date',
          )
          .addSelect('COUNT(*)', 'count')
          .andWhere("invoice.status = 'authorized'")
          .andWhere(
            'invoice.authorized_at >= :start AND invoice.authorized_at < :end',
            range,
          )
          .groupBy('1')
          .orderBy('1', 'ASC')
          .getRawMany<{ date: string; count: string }>(),
        created()
          .orderBy('invoice.created_at', 'DESC')
          .addOrderBy('invoice.id', 'DESC')
          .take(5)
          .getMany(),
      ]);
      const mapper = new InvoiceMapper();
      return {
        counts: {
          authorized: Number(counts?.authorized ?? 0),
          rejected: Number(counts?.rejected ?? 0),
          processing: Number(counts?.processing ?? 0),
        },
        dailyActivity: dailyActivity.map((day) => ({
          date: day.date,
          count: Number(day.count),
        })),
        recentInvoices: recent.map((invoice) => mapper.toDomain(invoice)),
      };
    });
  }
}
