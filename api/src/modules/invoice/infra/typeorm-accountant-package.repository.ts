import { Injectable } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  IAccountantPackageRepository,
  type AccountantCompany,
} from '../domain/accountant-package.repository';

const toCompany = (row: CompanyOrmEntity): AccountantCompany => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.tradeName ?? row.legalName,
  environment: row.environment as ExecutionEnvironment,
  accountantEmail: row.accountantEmail ?? null,
  lastSentMonth: row.accountantPackageLastSentMonth ?? null,
});

@Injectable()
export class TypeOrmAccountantPackageRepository implements IAccountantPackageRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private repo() {
    return this.db.repository(CompanyOrmEntity);
  }

  find(tenantId: string, companyId: string, environment: ExecutionEnvironment) {
    return runWithTenant(tenantId, async () => {
      const row = await this.repo().findOne({
        where: { id: companyId, tenantId, environment, deletedAt: IsNull() },
      });
      return row ? toCompany(row) : null;
    });
  }

  listEnabled(tenantId: string) {
    return runWithTenant(tenantId, async () => {
      const rows = await this.repo().find({
        where: {
          tenantId,
          environment: 'live',
          deletedAt: IsNull(),
          accountantEmail: Not(IsNull()),
        },
      });
      return rows.map(toCompany);
    });
  }

  setEmail(tenantId: string, companyId: string, email: string | null) {
    return runWithTenant(tenantId, async () => {
      await this.repo().update(
        { id: companyId, tenantId },
        { accountantEmail: email },
      );
    });
  }

  claimMonth(
    tenantId: string,
    companyId: string,
    month: string,
    force: boolean,
  ) {
    return runWithTenant(tenantId, async () => {
      const query = this.repo()
        .createQueryBuilder()
        .update(CompanyOrmEntity)
        .set({ accountantPackageLastSentMonth: month })
        .where('id = :companyId AND tenant_id = :tenantId', {
          companyId,
          tenantId,
        });
      if (!force)
        query.andWhere(
          'accountant_package_last_sent_month IS DISTINCT FROM :month',
          { month },
        );
      const result = await query.execute();
      return Boolean(result.affected);
    });
  }

  setLastSentMonth(tenantId: string, companyId: string, month: string | null) {
    return runWithTenant(tenantId, async () => {
      await this.repo().update(
        { id: companyId, tenantId },
        { accountantPackageLastSentMonth: month },
      );
    });
  }
}
