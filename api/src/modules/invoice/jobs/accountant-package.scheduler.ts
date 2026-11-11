import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { AccountantPackageService } from '../application/package/accountant-package.service';

const LAST_HOUR = 18;

/**
 * Day 1 of each month, every hour from 08:00 to 18:00 (São Paulo): sends the previous month's
 * package to each accountant. The hourly runs are the retry; a month already sent is skipped.
 */
@Injectable()
export class AccountantPackageScheduler {
  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly accountantPackages: AccountantPackageService,
  ) {}

  @Cron(`0 8-${LAST_HOUR} 1 * *`, { timeZone: 'America/Sao_Paulo' })
  async handleMonthly(): Promise<void> {
    await observeScheduledTask('accountant.package', () => this.run());
  }

  async run(now = new Date()): Promise<void> {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(now),
    );
    await this.discovery.visit('accountant-package', (tenantId) =>
      this.accountantPackages.sendMonthly(tenantId, now, hour >= LAST_HOUR),
    );
  }
}
