import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { ICompanyNfeSettingsRepository } from '../domain/company-nfe-settings.repository';
import {
  crtForRegime,
  type Crt,
  type NfeCsosn,
  type NfeSettings,
  type NfeSettingsInput,
} from '../domain/nfe-settings';
import { CompanyFiscalProfileOrmEntity } from './company-fiscal-profile.orm-entity';
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
      if (!row) return null;
      const settings = toDomain(row);
      if (settings.crt !== null) return settings;
      const manager = this.transactions.getManager() ?? this.dataSource.manager;
      const profile = await manager
        .getRepository(CompanyFiscalProfileOrmEntity)
        .findOne({ where: { companyId, tenantId, validUntil: IsNull() } });
      return { ...settings, crt: crtForRegime(profile?.taxRegime) };
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
          crt: input.crt ?? null,
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
