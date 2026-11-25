import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { IAccountAuditRepository } from '../domain/account-audit.repository';

export const AUDIT_RETENTION_DAYS = 365;

/** Daily purge of audit events older than one year. */
@Injectable()
export class AccountAuditRetentionScheduler {
  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly audit: IAccountAuditRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDaily(): Promise<void> {
    await observeScheduledTask('account-audit.retention', () => this.run());
  }

  async run(now = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.discovery.visit('account-audit-retention', async (tenantId) => {
      await this.audit.deleteOlderThan(tenantId, cutoff);
    });
  }
}
