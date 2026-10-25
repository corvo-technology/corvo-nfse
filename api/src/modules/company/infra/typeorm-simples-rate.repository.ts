import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type {
  ISimplesRateRepository,
  SimplesRate,
  SimplesRateInput,
} from '../domain/simples-rate';
import { CompanySimplesRateOrmEntity } from './company-simples-rate.orm-entity';

@Injectable()
export class TypeOrmSimplesRateRepository implements ISimplesRateRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private rates() {
    const manager = this.transactions.getManager() ?? this.dataSource.manager;
    return manager.getRepository(CompanySimplesRateOrmEntity);
  }

  async upsert(
    companyId: string,
    tenantId: string,
    month: string,
    input: SimplesRateInput,
  ): Promise<SimplesRate> {
    return runWithTenant(tenantId, async () => {
      const rates = this.rates();
      await rates.upsert(
        {
          tenantId,
          companyId,
          month,
          totalRate: input.totalRate,
          issRate: input.issRate ?? null,
          ibsRate: input.ibsRate ?? null,
          cbsRate: input.cbsRate ?? null,
          updatedAt: new Date(),
        },
        ['companyId', 'month'],
      );
      const row = await rates.findOneByOrFail({ companyId, tenantId, month });
      return toDomain(row);
    });
  }

  async list(companyId: string, tenantId: string): Promise<SimplesRate[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.rates().find({
        where: { companyId, tenantId },
        order: { month: 'DESC' },
      });
      return rows.map(toDomain);
    });
  }

  async findAtOrBefore(
    companyId: string,
    tenantId: string,
    month: string,
  ): Promise<SimplesRate | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.rates().findOne({
        where: { companyId, tenantId, month: LessThanOrEqual(month) },
        order: { month: 'DESC' },
      });
      return row ? toDomain(row) : null;
    });
  }
}

function toDomain(row: CompanySimplesRateOrmEntity): SimplesRate {
  return {
    companyId: row.companyId,
    month: row.month,
    totalRate: row.totalRate,
    issRate: row.issRate ?? null,
    ibsRate: row.ibsRate ?? null,
    cbsRate: row.cbsRate ?? null,
    updatedAt: row.updatedAt,
  };
}
