import { Injectable, Optional } from '@nestjs/common';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';

import { BillingRepository } from '../domain/billing.repository';
import { BillingPeriod, BillingRuleError } from '../domain/billing-period';
import { hasPaidAccess } from '../domain/billing-policy';

@Injectable()
export class BillingUsageService {
  constructor(
    private readonly repository: BillingRepository,
    @Optional() private readonly eventBus?: ApplicationEventBus,
  ) {}
  private isBlocked(
    current: Awaited<ReturnType<BillingRepository['current']>>,
  ) {
    return (
      !current.plan.active ||
      (current.plan.slug !== 'free' &&
        !hasPaidAccess(
          current.billing?.stripeStatus ?? null,
          current.billing?.paidUntil ?? null,
        ))
    );
  }
  async status(tenantId: string) {
    return this.repository.locked(tenantId, async () => {
      const current = await this.repository.current(tenantId);
      return {
        ...current,
        blocked: this.isBlocked(current),
        dailyUsage: await this.repository.dailyUsage(tenantId),
        avulsoBalance: await this.repository.avulsoBalance(tenantId),
        ...new BillingPeriod(current.period).summary,
      };
    });
  }
  /**
   * Reserves one note. The plan quota is spent first; when it is exhausted (or
   * the plan lapsed) the avulso balance pays instead. Returns the period id
   * when the plan paid, or null when the avulso balance did.
   */
  async reserve(tenantId: string): Promise<string | null> {
    return this.repository.locked(tenantId, async () => {
      const current = await this.repository.current(tenantId);
      const period = new BillingPeriod(current.period);
      try {
        period.reserve(
          this.isBlocked(current),
          current.plan.dailyLimit,
          current.plan.dailyLimit === null
            ? 0
            : await this.repository.dailyUsage(tenantId),
        );
      } catch (error) {
        const code = error instanceof BillingRuleError ? error.code : null;
        if (
          (code === 'plan_blocked' || code === 'monthly_limit_exceeded') &&
          (await this.repository.avulsoBalance(tenantId)) > 0
        )
          return null;
        // Out of notes: tell the admins (once a day), then fail the emission as before.
        if (code === 'plan_blocked' || code === 'monthly_limit_exceeded')
          this.eventBus?.publishBestEffort(
            accountNotice(tenantId, { kind: 'credits-exhausted' }),
          );
        throw error;
      }
      await this.repository.savePeriod(period.state, tenantId);
      return period.state.id;
    });
  }
  async settle(
    invoiceId: string,
    tenantId: string,
    status: string,
  ): Promise<void> {
    if (!['authorized', 'rejected', 'failed', 'cancelled'].includes(status))
      return;
    const periodId = await this.repository.reservedPeriod(invoiceId, tenantId);
    if (!periodId) return;
    const state = await this.repository.period(periodId, tenantId);
    if (!state)
      throw new BillingRuleError(
        'usage_period_missing',
        'Usage period missing',
        'not_found',
      );
    const period = new BillingPeriod(state);
    period.settle(status === 'authorized');
    await this.repository.savePeriod(period.state, tenantId);
  }
}
