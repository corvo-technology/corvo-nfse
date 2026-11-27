import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { LockPort } from '@/infra/redis/lock.port';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import { monthOf } from '@/modules/invoice/application/package/package-month';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { LifecycleEmailSettings } from '@/modules/credits-alerts/lifecycle-email.settings';
import { LifecycleEmailsService } from '../lifecycle-emails.service';

const HOUR_MS = 3_600_000;

/**
 * Day 1 of each month at 09:00 (São Paulo): the summary of the month that ended. Day 2 at 09:00 is
 * the catch-up for workspaces that were not reached; the ledger makes both runs safe together.
 */
@Injectable()
export class LifecycleMonthlySummaryScheduler {
  private readonly logger = new Logger(LifecycleMonthlySummaryScheduler.name);

  constructor(
    private readonly settings: LifecycleEmailSettings,
    private readonly discovery: TenantWorkDiscovery,
    private readonly lifecycle: LifecycleEmailsService,
    @Inject(LOCK_PORT) private readonly locks: LockPort,
  ) {}

  @Cron('0 9 1,2 * *', { timeZone: 'America/Sao_Paulo' })
  async handleMonthly(): Promise<void> {
    await observeScheduledTask('lifecycle.monthly-summary', () => this.run());
  }

  async run(now = new Date()): Promise<void> {
    if (!this.settings.isOn('monthlySummary')) return;
    // One worker runs the pass; the others skip it.
    const turn = await this.locks.acquire(
      `lifecycle:monthly-summary:${monthOf(now)}:${now.toISOString().slice(0, 10)}`,
      { ttlMs: 12 * HOUR_MS },
    );
    if (!turn) return;
    await this.discovery.visit(
      'lifecycle-monthly-summary',
      async (tenantId) => {
        await this.lifecycle.sendMonthlySummary(tenantId, now);
      },
    );
    this.logger.log({ event: 'lifecycle_monthly_summary_pass_done' });
  }
}

/** Every hour: reminds about checkouts started a day ago and still unpaid. */
@Injectable()
export class LifecyclePaymentReminderScheduler {
  constructor(
    private readonly settings: LifecycleEmailSettings,
    private readonly discovery: TenantWorkDiscovery,
    private readonly lifecycle: LifecycleEmailsService,
    @Inject(LOCK_PORT) private readonly locks: LockPort,
  ) {}

  @Cron('30 * * * *', { timeZone: 'America/Sao_Paulo' })
  async handleHourly(): Promise<void> {
    await observeScheduledTask('lifecycle.payment-reminder', () => this.run());
  }

  async run(now = new Date()): Promise<void> {
    if (!this.settings.isOn('pendingPayment')) return;
    const turn = await this.locks.acquire(
      `lifecycle:payment-reminder:${now.toISOString().slice(0, 13)}`,
      { ttlMs: 50 * 60_000 },
    );
    if (!turn) return;
    await this.discovery.visit(
      'lifecycle-payment-pending',
      async (tenantId) => {
        await this.lifecycle.sendPaymentReminder(tenantId, now);
      },
    );
  }
}
