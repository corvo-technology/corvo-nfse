import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { runAsPlatformAdminOnTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { PlatformAdminAuditRepository } from '../infra/platform-admin-audit.repository';
import type { NfeAccessResult } from '../platform-admin.contract';
import type { PlatformAdminActor } from '../platform-admin.guard';

export type NfeAccessInput = { enabled: boolean; reason: string };

type Updated = { nfe_enabled_at: Date | string | null };

/**
 * Turns NF-e on or off for one workspace. The column and the audit row are written in the same
 * transaction; the cache of `NfeAccessPolicy` is dropped after the commit.
 */
@Injectable()
export class PlatformNfeAccessService {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly db: TypeOrmRepositoryHelper,
    private readonly audit: PlatformAdminAuditRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  async set(
    actor: PlatformAdminActor,
    tenantId: string,
    input: NfeAccessInput,
  ): Promise<NfeAccessResult> {
    const result = await runAsPlatformAdminOnTenant(tenantId, () =>
      this.uow.execute(() => this.apply(actor, tenantId, input)),
    );
    await this.cache.delete(`nfe:enabled:${tenantId}`);
    return result;
  }

  private async apply(
    actor: PlatformAdminActor,
    tenantId: string,
    input: NfeAccessInput,
  ): Promise<NfeAccessResult> {
    const manager = this.db.manager();
    const table = manager.getRepository(TenantOrmEntity).metadata.tablePath;
    // The column is `update: false` in the entity (a new tenant never starts released), so raw SQL.
    const rows = (await manager.query(
      `UPDATE ${table} SET nfe_enabled_at = CASE WHEN $2::boolean THEN COALESCE(nfe_enabled_at, now()) ELSE NULL END WHERE id = $1 RETURNING nfe_enabled_at`,
      [tenantId, input.enabled],
    )) as unknown;
    const first = Array.isArray(rows) ? (rows as unknown[])[0] : undefined;
    // pg drivers answer [rows, count] for UPDATE ... RETURNING
    const row = (Array.isArray(first) ? first[0] : first) as
      Updated | undefined;
    if (!row || !('nfe_enabled_at' in row))
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    await this.audit.insert({
      actorUserId: actor.authUserId,
      actorEmail: actor.email,
      action: 'nfe_access_changed',
      targetTenantId: tenantId,
      reason: input.reason,
      payload: { enabled: input.enabled },
      success: true,
      ipHash: actor.ipHash,
    });
    return {
      tenantId,
      enabled: input.enabled,
      enabledAt: row.nfe_enabled_at
        ? new Date(row.nfe_enabled_at).toISOString()
        : null,
    };
  }
}
