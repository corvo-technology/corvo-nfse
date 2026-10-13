import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';

/**
 * Minimal tenant repository: the `tenants` table only carries
 * plan/billing state, no business logic.
 */
@Injectable()
export class TypeOrmTenantRepository {
  constructor(
    @InjectRepository(TenantOrmEntity)
    private readonly repo: Repository<TenantOrmEntity>,
  ) {}

  /** Idempotent on primary key. Used by AuthUserService during signup. */
  async createIfNotExists(tenantId: string, planId?: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.repo
        .createQueryBuilder()
        .insert()
        .values({ id: tenantId, planId: planId ?? null })
        .orIgnore()
        .execute();
    });
  }

  async findById(
    tenantId: string,
  ): Promise<{ id: string; planId: string | null } | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const tenant = await this.repo.findOne({
        where: { id: tenantId },
        select: { id: true, planId: true },
      });
      return tenant ? { id: tenant.id, planId: tenant.planId } : null;
    });
  }
}
