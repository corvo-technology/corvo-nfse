import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import type { LockPort } from '@/infra/redis/lock.port';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { IPortalSyncRepository } from '../domain/portal-sync.repository';
import { PortalSyncService } from '../application/portal-sync.service';

const LOCK_TTL_MS = 10 * 60_000;

/**
 * Every five minutes it visits the companies that have a certificate and reads the ones whose turn
 * has come (about once an hour each, spread over the hour). Off unless `PORTAL_SYNC_ENABLED` is set.
 * One company failing never stops the others, and nothing here is on the emission path.
 */
@Injectable()
export class PortalSyncScheduler {
  private readonly logger = new Logger(PortalSyncScheduler.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly repository: IPortalSyncRepository,
    private readonly sync: PortalSyncService,
    private readonly config: ConfigService,
    @Inject(LOCK_PORT) private readonly locks: LockPort,
  ) {}

  @Cron('*/5 * * * *')
  async handle(): Promise<void> {
    if (!this.config.get<boolean>('PORTAL_SYNC_ENABLED')) return;
    await observeScheduledTask('portal.sync', () => this.run());
  }

  private async run(): Promise<void> {
    await this.discovery.visit('portal-sync', async (tenantId) => {
      for (const target of await this.repository.listTargets(tenantId)) {
        // Another worker may be on the same company; skip it instead of waiting.
        const lock = await this.locks.acquire(
          `portal-sync:${target.companyId}:${target.environment}`,
          { ttlMs: LOCK_TTL_MS },
        );
        if (!lock) continue;
        try {
          await this.sync.sync(tenantId, target);
        } catch (error: unknown) {
          this.logger.error(
            { err: error, companyId: target.companyId },
            'Portal sync failed',
          );
        } finally {
          await this.locks.release(lock);
        }
      }
    });
  }
}
