import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { runAsPlatformAdminOnTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { PlatformAdminAuditRepository } from '../infra/platform-admin-audit.repository';
import { PlatformNfeAccessRepository } from '../infra/platform-nfe-access.repository';
import type { NfeAccessResult } from '../platform-admin.contract';
import type { PlatformAdminActor } from '../platform-admin.guard';

export type NfeAccessInput = { enabled: boolean; reason: string };

/**
 * Turns NF-e on or off for one workspace. The column and the audit row are written in the same
 * transaction; the cache of `NfeAccessPolicy` is dropped after the commit.
 */
@Injectable()
export class PlatformNfeAccessService {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly tenants: PlatformNfeAccessRepository,
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
    const updated = await this.tenants.setEnabled(tenantId, input.enabled);
    if (!updated)
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
      enabledAt: updated.enabledAt ? updated.enabledAt.toISOString() : null,
    };
  }
}
