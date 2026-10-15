import { Injectable } from '@nestjs/common';
import { BillingRepository } from '../domain/billing.repository';
import { BillingPeriod, BillingRuleError } from '../domain/billing-period';
import { hasPaidAccess } from '../domain/billing-policy';

@Injectable()
export class BillingUsageService {
  constructor(private readonly repository: BillingRepository) {}
  async status(tenantId: string) {
    return this.repository.locked(tenantId, async () => {
      const current = await this.repository.current(tenantId);
      const blocked =
        !current.plan.active ||
        (current.plan.slug !== 'free' &&
          !hasPaidAccess(
            current.billing?.stripeStatus ?? null,
            current.billing?.paidUntil ?? null,
          ));
      return {
        ...current,
        blocked,
        dailyUsage: await this.repository.dailyUsage(tenantId),
        ...new BillingPeriod(current.period).summary,
      };
    });
  }
  async reserve(tenantId: string): Promise<string> {
    const current = await this.repository.current(tenantId);
    const blocked =
      !current.plan.active ||
      (current.plan.slug !== 'free' &&
        !hasPaidAccess(
          current.billing?.stripeStatus ?? null,
          current.billing?.paidUntil ?? null,
        ));
    const period = new BillingPeriod(current.period);
    period.reserve(
      blocked,
      current.plan.dailyLimit,
      current.plan.dailyLimit === null
        ? 0
        : await this.repository.dailyUsage(tenantId),
    );
    await this.repository.savePeriod(period.state, tenantId);
    return period.state.id;
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
