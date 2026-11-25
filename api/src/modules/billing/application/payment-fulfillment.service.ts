import { Injectable } from '@nestjs/common';
import type { PaymentIntent } from '../domain/payment-intent';
import { BillingRepository } from '../domain/billing.repository';
import { addUtcMonths } from '../domain/billing-policy';
import { CreditsService } from '@/modules/credits/application/credits.service';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';
import type { BillingCycle } from '@/modules/plans/domain/plan';
import {
  AccountAuditRecorder,
  SYSTEM_ACTOR,
} from '@/modules/account-audit/domain/account-audit';

/** Delivers what a confirmed payment bought, whichever provider took the money. */
@Injectable()
export class PaymentFulfillmentService {
  constructor(
    private readonly credits: CreditsService,
    private readonly billing: BillingRepository,
    private readonly eventBus: ApplicationEventBus,
    private readonly audit: AccountAuditRecorder,
  ) {}

  async apply(intent: PaymentIntent): Promise<void> {
    if (intent.kind === 'avulso') {
      const granted = await this.credits.grantAvulso(
        intent.tenantId,
        intent.units!,
        `${intent.provider}:${intent.providerRef}`,
      );
      // A redelivered webhook grants nothing, so it never e-mails twice.
      if (granted.creditsGranted > 0)
        this.eventBus.publishBestEffort(
          accountNotice(intent.tenantId, {
            kind: 'credits-added',
            units: granted.creditsGranted,
          }),
        );
      if (granted.creditsGranted > 0) await this.confirmed(intent);
      return;
    }
    await this.activatePlan(intent.tenantId, intent.planSlug!, intent.cycle!);
    await this.confirmed(intent);
  }

  /** Only the confirmation is audited here; the charge itself is audited when it is created. */
  private confirmed(intent: PaymentIntent): Promise<void> {
    return this.audit.record({
      tenantId: intent.tenantId,
      action: 'billing.payment_confirmed',
      actor: SYSTEM_ACTOR,
      target: { type: 'payment', id: intent.id },
      metadata: {
        provider: intent.provider,
        method: intent.provider === 'stripe' ? 'card' : 'pix',
        kind: intent.kind,
        units: intent.units,
        amount_cents: intent.amountCents,
      },
    });
  }

  async activatePlan(
    tenantId: string,
    planSlug: string,
    cycle: BillingCycle,
  ): Promise<void> {
    const plan = await this.billing.plan(planSlug);
    if (!plan) throw new Error(`Unknown plan ${planSlug}`);
    const now = new Date();
    let from: string | null = null;
    await this.billing.locked(tenantId, async () => {
      from = (await this.billing.current(tenantId)).plan.slug;
      await this.billing.setPlan(tenantId, plan.id);
      await this.billing.saveBilling(tenantId, {
        // Entitlement now comes from this payment; a stale Stripe subscription must not overwrite it.
        stripeSubscriptionId: null,
        stripeStatus: 'active',
        paidUntil: addUtcMonths(now, cycle === 'annual' ? 12 : 1),
        currentPeriodStart: now,
        currentPeriodEnd: addUtcMonths(now, 1),
        pendingPlanSlug: null,
        cancelAtPeriodEnd: false,
      });
    });
    if (from !== plan.slug)
      await this.audit.record({
        tenantId,
        action: 'billing.plan_changed',
        target: { type: 'plan', id: plan.slug, label: plan.slug },
        metadata: { from, to: plan.slug },
      });
  }
}
