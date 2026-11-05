import { ApplicationError } from '@/shared/errors/application-error';
import { usageSummary } from './billing-policy';

export class BillingRuleError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    kind: 'validation' | 'conflict' | 'not_found' = 'validation',
  ) {
    super({ code, kind, safeMessage: message });
  }
}

export interface BillingPeriodState {
  id: string;
  tenantId: string;
  planSlug: string;
  periodStart: Date;
  periodEnd: Date;
  included: number;
  authorized: number;
  reserved: number;
  customerId: string | null;
  subscriptionId: string | null;
}

/** A monthly franchise and its billable, authorized consumption. No provider or persistence dependencies. */
export class BillingPeriod {
  constructor(readonly state: BillingPeriodState) {}
  get summary() {
    return usageSummary(
      this.state.included,
      this.state.authorized,
      this.state.reserved,
    );
  }
  reserve(
    blocked: boolean,
    dailyLimit: number | null,
    dailyUsed: number,
  ): void {
    if (blocked)
      throw new BillingRuleError(
        'plan_blocked',
        'Paid subscription required or payment grace expired',
      );
    if (
      this.state.authorized + this.state.reserved >=
      this.summary.hard_limit
    ) {
      throw new BillingRuleError(
        'monthly_limit_exceeded',
        'Monthly processing limit reached',
      );
    }
    if (dailyLimit !== null && dailyUsed >= dailyLimit)
      throw new BillingRuleError(
        'daily_limit_exceeded',
        'Daily processing limit reached',
      );
    this.state.reserved += 1;
  }
  settle(authorized: boolean): void {
    if (this.state.reserved < 1)
      throw new BillingRuleError(
        'invalid_usage_reservation',
        'No reserved processing to settle',
        'conflict',
      );
    this.state.reserved -= 1;
    if (authorized) this.state.authorized += 1;
  }
}
