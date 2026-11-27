import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { UF_TABLE } from '@/infra/external/nfe/sefaz/uf';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';

/**
 * Who hears about a change of the SVC of a UF: the workspaces with at least one
 * company in that UF, in the environment of `tpAmb`. Worker discovery, so it reads across workspaces.
 */
@Injectable()
export class TypeormNfeSvcAudience {
  constructor(private readonly database: DataSource) {}

  async tenants(uf: string, tpAmb: 1 | 2): Promise<string[]> {
    const rows = await runAsSystem('worker-discovery', () =>
      this.database
        .getRepository(CompanyOrmEntity)
        .createQueryBuilder('company')
        .select('company.tenant_id', 'tenantId')
        .distinct(true)
        .where(
          'company.address_state = :uf AND company.environment = :environment AND company.deleted_at IS NULL',
          { uf: uf.toUpperCase(), environment: tpAmb === 1 ? 'live' : 'test' },
        )
        .getRawMany<{ tenantId: string }>(),
    );
    return rows.map((row) => row.tenantId);
  }

  /**
   * The UF x environment pairs that have at least one company with NF-e settings (the only ones
   * the SVC switch needs to watch). Production (`tpAmb` 1) only when `production` is true.
   */
  async monitoredTargets(
    production: boolean,
  ): Promise<{ uf: Uf; tpAmb: 1 | 2 }[]> {
    // The settings table lives in the same schema as the companies.
    const schema = this.database.getMetadata(CompanyOrmEntity).schema;
    const settingsTable = schema
      ? `${this.database.driver.escape(schema)}.company_nfe_settings`
      : 'company_nfe_settings';
    const rows = await runAsSystem('worker-discovery', () =>
      this.database
        .getRepository(CompanyOrmEntity)
        .createQueryBuilder('company')
        .select('company.address_state', 'uf')
        .addSelect('company.environment', 'environment')
        .distinct(true)
        .where(
          `company.deleted_at IS NULL AND EXISTS (SELECT 1 FROM ${settingsTable} settings WHERE settings.company_id = company.id AND settings.tenant_id = company.tenant_id)`,
        )
        .getRawMany<{ uf: string | null; environment: string }>(),
    );
    const found = new Map<string, { uf: Uf; tpAmb: 1 | 2 }>();
    for (const row of rows) {
      const uf = row.uf?.toUpperCase();
      if (!uf || !(uf in UF_TABLE)) continue;
      const tpAmb = row.environment === 'live' ? 1 : 2;
      if (tpAmb === 1 && !production) continue;
      found.set(`${uf}-${tpAmb}`, { uf: uf as Uf, tpAmb });
    }
    return [...found.values()];
  }
}
