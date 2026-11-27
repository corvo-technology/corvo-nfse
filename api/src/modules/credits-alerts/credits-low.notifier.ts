import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import type { LockPort } from '@/infra/redis/lock.port';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import {
  CREDITS_USAGE_CHANGED,
  type CreditsUsageChangedEvent,
} from '@/modules/billing/application/credits-usage.events';
import { EmailService } from '@/modules/email/application/email.service';
import { CreditsPace } from './credits-pace.service';
import { LifecycleEmailSettings } from './lifecycle-email.settings';
import { TenantRecipientsService } from './tenant-recipients.service';

/** Share of the period's included credits that triggers the warning. */
export const CREDITS_LOW_THRESHOLD = 0.8;
const DAY_MS = 86_400_000;

/**
 * Warns the workspace admins/billing members once per billing period when the
 * included credits reach 80% (used + reserved). Failures never affect emission:
 * the event is published best-effort after the reservation committed.
 */
@Injectable()
export class CreditsLowNotifier {
  private readonly logger = new Logger(CreditsLowNotifier.name);

  constructor(
    private readonly usage: BillingUsageService,
    private readonly recipientsOf: TenantRecipientsService,
    private readonly email: EmailService,
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    private readonly pace: CreditsPace,
    private readonly settings: LifecycleEmailSettings,
  ) {}

  @OnEvent(CREDITS_USAGE_CHANGED)
  async onUsageChanged(event: CreditsUsageChangedEvent): Promise<void> {
    await runWithTenant(event.tenantId, () => this.notify(event.tenantId));
  }

  async notify(tenantId: string): Promise<void> {
    const status = await this.usage.status(tenantId);
    const { included, authorized, reserved } = status.period;
    if (included <= 0) return;
    const used = authorized + reserved;
    if (used < Math.ceil(included * CREDITS_LOW_THRESHOLD)) return;

    // One warning per period: the marker lives until the period ends.
    const ttlMs = Math.max(
      status.period.periodEnd.getTime() - Date.now() + DAY_MS,
      DAY_MS,
    );
    const marker = await this.locks.acquire(
      `credits-low:${tenantId}:${status.period.id}`,
      { ttlMs },
    );
    if (!marker) return;

    const recipients = await this.recipientsOf.emailsFor(tenantId);
    if (recipients.length === 0) {
      this.logger.warn({ event: 'credits_low_no_recipients', tenantId });
      return;
    }
    const remaining = Math.max(included - used, 0);
    const daysLeft = await this.forecast(
      tenantId,
      remaining,
      status.period.periodEnd,
    );
    for (const to of recipients)
      await this.email.enqueueCreditsLow({
        to,
        planName: status.plan.name,
        remaining,
        total: included,
        daysLeft,
      });
    this.logger.log({
      event: 'credits_low_notified',
      tenantId,
      used,
      included,
      recipients: recipients.length,
    });
  }

  /**
   * Days until the credits run out at the pace of the last 30 days. Null (the sentence is left out)
   * when there is not enough history or when the plan renews before they would run out.
   */
  private async forecast(
    tenantId: string,
    remaining: number,
    periodEnd: Date,
  ): Promise<number | null> {
    if (!this.settings.isOn('creditsForecast') || remaining <= 0) return null;
    try {
      const perDay = await this.pace.perDay(tenantId);
      if (!perDay) return null;
      const days = Math.max(1, Math.ceil(remaining / perDay));
      const untilRenewal = Math.ceil(
        (periodEnd.getTime() - Date.now()) / DAY_MS,
      );
      return days <= untilRenewal ? days : null;
    } catch (error) {
      this.logger.warn({
        event: 'credits_forecast_failed',
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
