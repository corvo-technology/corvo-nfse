import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { ICompanyNfeSettingsRepository } from '../domain/company-nfe-settings.repository';
import type {
  Crt,
  NfeCsosn,
  NfeSettings,
  NfeSettingsInput,
} from '../domain/nfe-settings';
import { CompanyNfeSettingsOrmEntity } from './company-nfe-settings.orm-entity';

@Injectable()
export class TypeOrmCompanyNfeSettingsRepository implements ICompanyNfeSettingsRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private settings() {
    const manager = this.transactions.getManager() ?? this.dataSource.manager;
    return manager.getRepository(CompanyNfeSettingsOrmEntity);
  }

  async find(companyId: string, tenantId: string): Promise<NfeSettings | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.settings().findOneBy({ companyId, tenantId });
      return row ? toDomain(row) : null;
    });
  }

  async upsert(
    companyId: string,
    tenantId: string,
    input: Required<NfeSettingsInput>,
  ): Promise<NfeSettings> {
    return runWithTenant(tenantId, async () => {
      const repo = this.settings();
      await repo.upsert(
        {
          companyId,
          tenantId,
          stateRegistration: input.stateRegistration,
          crt: input.crt,
          defaultSeries: input.defaultSeries,
          defaultNatOp: input.defaultNatOp,
          defaultCsosn: input.defaultCsosn,
          defaultOrigin: input.defaultOrigin,
          defaultPisCst: input.defaultPisCst,
          defaultCofinsCst: input.defaultCofinsCst,
        },
        ['companyId'],
      );
      return toDomain(await repo.findOneByOrFail({ companyId, tenantId }));
    });
  }
}

function toDomain(row: CompanyNfeSettingsOrmEntity): NfeSettings {
  return {
    companyId: row.companyId,
    tenantId: row.tenantId,
    stateRegistration: row.stateRegistration,
    crt: row.crt as Crt | null,
    defaultSeries: row.defaultSeries,
    defaultNatOp: row.defaultNatOp,
    defaultCsosn: row.defaultCsosn as NfeCsosn,
    defaultOrigin: row.defaultOrigin,
    defaultPisCst: row.defaultPisCst,
    defaultCofinsCst: row.defaultCofinsCst,
    enabledAt: row.enabledAt,
  };
}
