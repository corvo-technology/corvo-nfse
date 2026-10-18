import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { BillingRepository } from '../domain/billing.repository';
import {
  BillingProvider,
  type ProviderSubscription,
} from '../domain/billing-provider.port';
import { subscriptionDecision } from '../domain/subscription-policy';
import { hasPaidAccess } from '../domain/billing-policy';
import { BillingRuleError } from '../domain/billing-period';
import { isSupportedStripeEvent } from '../domain/stripe-webhook-events';
import {
  PAID_CATALOG_PLAN_SLUGS,
  isLegacyPlanSlug,
} from '@/modules/plans/domain/plan';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly repository: BillingRepository,
    private readonly provider: BillingProvider,
  ) {}

  async checkout(tenantId: string, planSlug: string, requestKey: string) {
    if (!requestKey || requestKey.length > 200)
      throw new BillingRuleError(
        'idempotency_key_required',
        'Idempotency-Key must contain 1 to 200 characters',
      );
    // Persist the intent before any provider call. A lost response always resumes this same intent.
    await this.repository.locked(tenantId, async () => {
      const plan = await this.repository.plan(planSlug);
      if (
        !plan?.active ||
        !(PAID_CATALOG_PLAN_SLUGS as readonly string[]).includes(planSlug)
      )
        throw new BillingRuleError(
          'invalid_checkout_plan',
          'An active paid plan is required',
        );
      const state = await this.repository.billing(tenantId);
      const intent = state?.checkoutState;
      if (intent?.requestKey === requestKey) {
        if (intent.planSlug !== planSlug)
          throw new BillingRuleError(
            'idempotency_conflict',
            'Idempotency-Key already belongs to another plan',
            'conflict',
          );
        return;
      }
      if (
        intent &&
        (!intent.sessionId ||
          (intent.expiresAt && new Date(intent.expiresAt) > new Date()))
      ) {
        if (intent.planSlug !== planSlug)
          throw new BillingRuleError(
            'checkout_in_progress',
            'Another plan checkout is already open',
            'conflict',
          );
        return;
      }
      await this.repository.saveBilling(tenantId, {
        checkoutState: {
          id: randomUUID(),
          requestKey,
          planSlug,
          sessionId: null,
          url: null,
          expiresAt: null,
          createdAt: new Date().toISOString(),
        },
      });
    });
    return this.repository.locked(tenantId, async () => {
      let billing = await this.repository.billing(tenantId);
      const intent = billing!.checkoutState!;
      if (!billing!.stripeCustomerId) {
        const customerId = await this.provider.createCustomer(
          tenantId,
          billing!.billingEmail,
        );
        await this.repository.saveBilling(tenantId, {
          stripeCustomerId: customerId,
        });
        billing = await this.repository.billing(tenantId);
      }
      const customerId = billing!.stripeCustomerId!;
      const existing = intent.sessionId
        ? await this.provider.checkout(intent.sessionId)
        : await this.provider.findCheckout(customerId, intent.id);
      if (existing) {
        if (existing.customerId !== customerId)
          throw new BillingRuleError(
            'checkout_owner_mismatch',
            'Checkout ownership mismatch',
            'conflict',
          );
        await this.repository.saveBilling(tenantId, {
          checkoutState: {
            ...intent,
            sessionId: existing.id,
            url: existing.url,
            expiresAt: existing.expiresAt.toISOString(),
          },
        });
        if (existing.status === 'expired')
          throw new BillingRuleError(
            'checkout_expired',
            'Checkout expired; use a new Idempotency-Key',
            'conflict',
          );
        return { session_id: existing.id, url: existing.url };
      }
      if ((await this.provider.liveSubscriptions(customerId)).length)
        throw new BillingRuleError(
          'subscription_exists',
          'Change the existing subscription instead of creating another checkout',
          'conflict',
        );
      const session = await this.provider.createCheckout(
        customerId,
        tenantId,
        intent.planSlug,
        intent.id,
      );
      if (!session.url)
        throw new BillingRuleError(
          'checkout_url_missing',
          'Provider did not return a checkout URL',
          'conflict',
        );
      await this.repository.saveBilling(tenantId, {
        checkoutState: {
          ...intent,
          sessionId: session.id,
          url: session.url,
          expiresAt: session.expiresAt.toISOString(),
        },
      });
      return { session_id: session.id, url: session.url };
    });
  }

  async checkoutStatus(tenantId: string, sessionId: string) {
    const billing = await this.repository.billing(tenantId);
    if (!billing?.stripeCustomerId)
      throw new BillingRuleError(
        'checkout_not_found',
        'Checkout not found',
        'not_found',
      );
    const session = await this.provider.checkout(sessionId);
    if (session.customerId !== billing.stripeCustomerId)
      throw new BillingRuleError(
        'checkout_not_found',
        'Checkout not found',
        'not_found',
      );
    return {
      session_id: session.id,
      status: session.status,
      payment_status: session.paymentStatus,
      activated:
        session.subscriptionId === billing.stripeSubscriptionId &&
        hasPaidAccess(billing.stripeStatus, billing.paidUntil),
    };
  }

  async changePlan(tenantId: string, slug: string) {
    return this.repository.locked(tenantId, async () => {
      const plan = await this.repository.plan(slug);
      if (!plan?.active)
        throw new BillingRuleError(
          'invalid_plan',
          'An active plan is required',
        );
      if (isLegacyPlanSlug(slug)) {
        const { plan: currentPlan } = await this.repository.current(tenantId);
        // Legacy plans are grandfathered, not selectable; the only valid
        // legacy "change" is undoing a scheduled downgrade/cancellation.
        if (currentPlan.slug !== slug)
          throw new BillingRuleError(
            'invalid_plan',
            'Legacy plans are only available to their current subscribers',
          );
      }
      const billing = await this.repository.billing(tenantId);
      if (!billing?.stripeSubscriptionId)
        throw new BillingRuleError(
          'subscription_required',
          'Create a checkout to subscribe first',
          'conflict',
        );
      await this.provider.scheduleChange(billing.stripeSubscriptionId, slug);
      await this.applySubscription(
        tenantId,
        await this.provider.subscription(billing.stripeSubscriptionId),
      );
      const updated = await this.repository.billing(tenantId);
      return {
        scheduled_plan: updated?.pendingPlanSlug,
        effective_at: updated?.currentPeriodEnd?.toISOString(),
      };
    });
  }
  async portal(tenantId: string) {
    const billing = await this.repository.billing(tenantId);
    if (!billing?.stripeCustomerId)
      throw new BillingRuleError(
        'customer_required',
        'Subscribe before managing billing',
        'conflict',
      );
    return { url: await this.provider.portal(billing.stripeCustomerId) };
  }

  async webhook(body: Buffer, signature: string) {
    const event = this.provider.verifyEvent(body, signature);
    if (!isSupportedStripeEvent(event.type)) {
      this.logger.debug({
        event: 'stripe_event_unsupported',
        stripeEventId: event.id,
        type: event.type,
      });
      return;
    }
    const tenantId = event.customerId
      ? await this.repository.customerTenant(event.customerId)
      : null;
    // Unknown events also need serialization: they share an event-specific lock.
    const withLock = (work: () => Promise<void>) =>
      tenantId
        ? this.repository.locked(tenantId, work)
        : this.repository.lockedProviderEvent(event.id, work);
    await withLock(async () => {
      if (await this.repository.eventSeen(event.id)) return;
      if (tenantId && event.subscriptionId) {
        await this.applySubscription(
          tenantId,
          await this.provider.subscription(event.subscriptionId),
        );
      } else
        this.logger.debug({
          event: 'stripe_event_ignored',
          stripeEventId: event.id,
          type: event.type,
        });
      await this.repository.recordEvent(
        event.id,
        event.type,
        createHash('sha256').update(body).digest('hex'),
      );
    });
  }

  /** Verified provider state, never browser parameters or an unverified event payload. */
  private async applySubscription(tenantId: string, sub: ProviderSubscription) {
    const billing = await this.repository.billing(tenantId);
    if (!billing || billing.stripeCustomerId !== sub.customerId) return;
    if (
      billing.stripeSubscriptionId &&
      billing.stripeSubscriptionId !== sub.id
    ) {
      const current = await this.provider.subscription(
        billing.stripeSubscriptionId,
      );
      if (!['canceled', 'incomplete_expired'].includes(current.status)) return;
      if (['canceled', 'incomplete_expired'].includes(sub.status)) return;
    }
    const plan = sub.planSlug ? await this.repository.plan(sub.planSlug) : null;
    if (!plan) {
      this.logger.error({
        event: 'stripe_unknown_plan',
        subscriptionId: sub.id,
      });
      return;
    }
    const tenant = await this.repository.current(tenantId);
    const decision = subscriptionDecision(tenant.plan.slug, sub);
    const entitledPlan = await this.repository.plan(decision.planSlug);
    if (entitledPlan && entitledPlan.id !== tenant.plan.id)
      await this.repository.setPlan(tenantId, entitledPlan.id);
    await this.repository.saveBilling(tenantId, {
      stripeSubscriptionId: sub.id,
      stripeStatus: decision.status,
      paidUntil: sub.paidUntil,
      currentPeriodStart: sub.periodStart,
      currentPeriodEnd: sub.periodEnd,
      pendingPlanSlug: sub.cancelAtPeriodEnd ? 'free' : sub.pendingPlanSlug,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    });
    // Snapshot the purchased allowance/rate once. Later catalog changes do not reprice past use.
    if (decision.purchased) {
      const { period } = await this.repository.current(tenantId);
      if (
        period.authorized === 0 &&
        period.reserved === 0 &&
        period.reported === 0
      ) {
        period.included = sub.included;
        period.unitCents = sub.unitCents;
        await this.repository.savePeriod(period, tenantId);
      }
    }
  }
  async reconcile() {
    if (!this.provider.enabled) return;
    await this.discovery.visit('billing-reconciliation', async (tenantId) => {
      try {
        await this.repository.locked(tenantId, async () => {
          const billing = await this.repository.billing(tenantId);
          const ids = billing?.stripeCustomerId
            ? await this.provider.liveSubscriptions(billing.stripeCustomerId)
            : [];
          const id = ids[0] ?? billing?.stripeSubscriptionId;
          if (id)
            await this.applySubscription(
              tenantId,
              await this.provider.subscription(id),
            );
        });
      } catch (error: unknown) {
        this.logger.error({
          event: 'billing_reconciliation_failed',
          tenantId,
          error,
        });
      }
    });
  }
}
