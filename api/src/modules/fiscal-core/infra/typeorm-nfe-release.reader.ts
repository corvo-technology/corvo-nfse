import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { NfeReleaseReader } from '../domain/nfe-release.reader';

@Injectable()
export class TypeormNfeReleaseReader implements NfeReleaseReader {
  constructor(
    @InjectRepository(TenantOrmEntity)
    private readonly tenants: Repository<TenantOrmEntity>,
  ) {}

  async releasedAt(tenantId: string): Promise<Date | null> {
    return runWithTenant(tenantId, async () => {
      const tenant = await this.tenants.findOne({
        where: { id: tenantId },
        select: { id: true, nfeEnabledAt: true },
      });
      return tenant?.nfeEnabledAt ?? null;
    });
  }
}
