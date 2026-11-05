import { Injectable } from '@nestjs/common';
import type { PaymentIntent } from '../domain/payment-intent';
import { BillingRepository } from '../domain/billing.repository';
import { addUtcMonths } from '../domain/billing-policy';
import { CreditsService } from '@/modules/credits/application/credits.service';
import type { BillingCycle } from '@/modules/plans/domain/plan';

/** Delivers what a confirmed payment bought, whichever provider took the money. */
@Injectable()
export class PaymentFulfillmentService {
  constructor(
    private readonly credits: CreditsService,
    private readonly billing: BillingRepository,
  ) {}

  async apply(intent: PaymentIntent): Promise<void> {
    if (intent.kind === 'avulso') {
      await this.credits.grantAvulso(
        intent.tenantId,
        intent.units!,
        `${intent.provider}:${intent.providerRef}`,
      );
      return;
    }
    await this.activatePlan(intent.tenantId, intent.planSlug!, intent.cycle!);
  }

  async activatePlan(
    tenantId: string,
    planSlug: string,
    cycle: BillingCycle,
  ): Promise<void> {
    const plan = await this.billing.plan(planSlug);
    if (!plan) throw new Error(`Unknown plan ${planSlug}`);
    const now = new Date();
    await this.billing.locked(tenantId, async () => {
      await this.billing.setPlan(tenantId, plan.id);
      await this.billing.saveBilling(tenantId, {
        stripeStatus: 'active',
        paidUntil: addUtcMonths(now, cycle === 'annual' ? 12 : 1),
        currentPeriodStart: now,
        currentPeriodEnd: addUtcMonths(now, 1),
        pendingPlanSlug: null,
        cancelAtPeriodEnd: false,
      });
    });
  }
}
