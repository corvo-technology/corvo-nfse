import { Injectable } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { AccountantPackageSendOrmEntity } from './accountant-package-send.orm-entity';
import {
  IAccountantPackageRepository,
  type AccountantCompany,
  type AccountantSendRecord,
  type AccountantSendRecordStatus,
  type NewAccountantSendRecord,
} from '../domain/accountant-package.repository';

const toCompany = (row: CompanyOrmEntity): AccountantCompany => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.tradeName ?? row.legalName,
  taxId: row.taxId,
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

  recordSend(entry: NewAccountantSendRecord) {
    return runWithTenant(entry.tenantId, async () => {
      await this.db.repository(AccountantPackageSendOrmEntity).insert({
        tenantId: entry.tenantId,
        companyId: entry.companyId,
        month: entry.month,
        recipient: entry.recipient,
        invoiceCount: entry.invoiceCount,
        totalCents: String(entry.totalCents),
        status: entry.status,
        trigger: entry.trigger,
      });
    });
  }

  listSends(tenantId: string, companyId: string, limit: number) {
    return runWithTenant(tenantId, async () => {
      const rows = await this.db
        .repository(AccountantPackageSendOrmEntity)
        .find({
          where: { tenantId, companyId },
          order: { createdAt: 'DESC' },
          take: limit,
        });
      return rows.map((row): AccountantSendRecord => ({
        id: row.id,
        month: row.month,
        recipient: row.recipient,
        invoiceCount: row.invoiceCount,
        totalCents: Number(row.totalCents),
        status: row.status as AccountantSendRecordStatus,
        trigger: row.trigger as AccountantSendRecord['trigger'],
        createdAt: row.createdAt,
      }));
    });
  }

  hasSend(
    tenantId: string,
    companyId: string,
    month: string,
    status: AccountantSendRecordStatus,
  ) {
    return runWithTenant(tenantId, () =>
      this.db
        .repository(AccountantPackageSendOrmEntity)
        .exists({ where: { tenantId, companyId, month, status } }),
    );
  }
}
