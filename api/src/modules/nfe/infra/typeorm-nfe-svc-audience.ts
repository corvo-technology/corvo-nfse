import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
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
}
