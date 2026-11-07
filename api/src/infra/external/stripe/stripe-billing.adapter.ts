import { CHECKOUT_BRANDING } from './stripe-branding';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Stripe from 'stripe';
import { PricingService } from '@/modules/plans/application/pricing.service';
import type { PlanSlug } from '@/modules/plans/domain/plan';
import {
  BillingProvider,
  type ProviderCheckout,
  type ProviderSubscription,
} from '@/modules/billing/domain/billing-provider.port';
import { stripeId } from './stripe-reference';
import { StripeGateway } from './stripe.gateway';

export const SUBSCRIPTION_EXPAND = [
  'items.data.price.product',
  'schedule.phases.items.price',
];

@Injectable()
export class StripeBillingAdapter extends BillingProvider {
  constructor(
    private readonly gateway: StripeGateway,
    private readonly pricing: PricingService,
  ) {
    super();
  }
  get enabled() {
    return this.gateway.enabled;
  }
  private get stripe() {
    return this.gateway.stripe;
  }
  private checkoutView(session: Stripe.Checkout.Session): ProviderCheckout {
    return {
      id: session.id,
      url: session.url,
      expiresAt: new Date(session.expires_at * 1000),
      status: session.status,
      paymentStatus: session.payment_status,
      customerId: stripeId(session.customer),
      subscriptionId: stripeId(session.subscription),
      intentId:
        session.mode === 'payment'
          ? (session.metadata?.intent_id ?? null)
          : null,
    };
  }
  async createCustomer(tenantId: string, email: string | null) {
    return (
      await this.stripe.customers.create(
        { metadata: { tenant_id: tenantId }, ...(email ? { email } : {}) },
        { idempotencyKey: `corvo:customer:${tenantId}` },
      )
    ).id;
  }
  async liveSubscriptions(customerId: string) {
    const list = this.stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    });
    const ids: string[] = [];
    for await (const sub of list)
      if (!['canceled', 'incomplete_expired'].includes(sub.status))
        ids.push(sub.id);
    return ids;
  }
  async checkout(id: string) {
    return this.checkoutView(await this.stripe.checkout.sessions.retrieve(id));
  }
  async findCheckout(customerId: string, intentId: string) {
    for await (const session of this.stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
    })) {
      if (session.metadata?.intent_id === intentId)
        return this.checkoutView(session);
    }
    return null;
  }
  private async prices(slug: string) {
    const quote = this.pricing.calculateQuote(slug as PlanSlug, 'monthly');
    if (!quote.basePriceCents)
      throw new BadRequestException({
        code: 'FREE_PLAN_NO_CHECKOUT',
        message: 'Free plan does not require checkout',
      });
    const keys = [`corvo_${slug}_monthly`];
    const { data } = await this.stripe.prices.list({
      lookup_keys: keys,
      active: true,
    });
    const base = data.find((p) => p.lookup_key === keys[0]);
    if (
      !base ||
      base.currency !== 'brl' ||
      base.unit_amount !== quote.basePriceCents ||
      base.recurring?.interval !== 'month' ||
      base.metadata.plan_slug !== slug
    ) {
      throw new ServiceUnavailableException({
        code: 'BILLING_UNAVAILABLE',
        message: 'Stripe prices must be provisioned for the current catalog',
      });
    }
    return { base };
  }
  async createCheckout(
    customerId: string,
    tenantId: string,
    planSlug: string,
    intentId: string,
  ) {
    const { base } = await this.prices(planSlug);
    const success = new URL(this.gateway.config.checkoutSuccessUrl);
    success.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        ui_mode: 'hosted_page',
        customer: customerId,
        client_reference_id: tenantId,
        metadata: { tenant_id: tenantId, intent_id: intentId },
        subscription_data: { metadata: { tenant_id: tenantId } },
        allowed_payment_method_types: ['card'],
        // Coupons live in the Stripe dashboard; the customer types the code on the hosted page.
        allow_promotion_codes: true,
        locale: 'pt-BR',
        branding_settings: CHECKOUT_BRANDING,
        line_items: [{ price: base.id, quantity: 1 }],
        success_url: success
          .toString()
          .replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'),
        cancel_url: this.gateway.config.checkoutCancelUrl,
      },
      { idempotencyKey: `corvo:checkout:${intentId}` },
    );
    return this.checkoutView(session);
  }
  async createPaymentCheckout(
    customerId: string,
    tenantId: string,
    input: { name: string; amountCents: number; intentId: string },
  ) {
    const success = new URL(this.gateway.config.checkoutSuccessUrl);
    success.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        ui_mode: 'hosted_page',
        customer: customerId,
        client_reference_id: tenantId,
        metadata: { tenant_id: tenantId, intent_id: input.intentId },
        allowed_payment_method_types: ['card'],
        // Coupons live in the Stripe dashboard; the customer types the code on the hosted page.
        allow_promotion_codes: true,
        locale: 'pt-BR',
        branding_settings: CHECKOUT_BRANDING,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'brl',
              unit_amount: input.amountCents,
              product_data: { name: input.name },
            },
          },
        ],
        success_url: success
          .toString()
          .replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'),
        cancel_url: this.gateway.config.checkoutCancelUrl,
      },
      { idempotencyKey: `corvo:pay:${input.intentId}` },
    );
    return { id: session.id, url: session.url };
  }
  async subscription(id: string): Promise<ProviderSubscription> {
    const sub = await this.stripe.subscriptions.retrieve(id, {
      expand: SUBSCRIPTION_EXPAND,
    });
    const base = sub.items.data.find(
      (i) => i.price.recurring?.usage_type !== 'metered',
    );
    const overage = sub.items.data.find(
      (i) => i.price.recurring?.usage_type === 'metered',
    );
    const slug = base?.price.metadata.plan_slug ?? null;
    let paidUntil: Date | null = null;
    let paidPlanSlug: string | null = null;
    for await (const invoice of this.stripe.invoices.list({
      subscription: id,
      status: 'paid',
      limit: 100,
    })) {
      for await (const line of this.stripe.invoices.listLineItems(invoice.id, {
        limit: 100,
      })) {
        const priceId = stripeId(line.pricing?.price_details?.price);
        if (!priceId || line.parent?.subscription_item_details?.proration)
          continue;
        const price =
          priceId === base?.price.id
            ? base.price
            : await this.stripe.prices.retrieve(priceId);
        if (price.metadata.kind !== 'base' || !price.metadata.plan_slug)
          continue;
        const end = new Date(line.period.end * 1000);
        if (!paidUntil || end > paidUntil) {
          paidUntil = end;
          paidPlanSlug = price.metadata.plan_slug;
        }
      }
      // Ordered newest first; one settled regular invoice gives the current paid entitlement.
      if (paidUntil) break;
    }
    const schedule = typeof sub.schedule === 'object' ? sub.schedule : null;
    const future = schedule?.phases
      .at(-1)
      ?.items.find(
        (i) =>
          typeof i.price === 'object' &&
          !('deleted' in i.price) &&
          i.price.metadata.kind === 'base',
      );
    const pending =
      future && typeof future.price === 'object' && !('deleted' in future.price)
        ? future.price.metadata.plan_slug
        : null;
    return {
      id: sub.id,
      customerId: stripeId(sub.customer)!,
      status: sub.status,
      planSlug: slug,
      periodStart: new Date((base?.current_period_start ?? sub.created) * 1000),
      periodEnd: new Date((base?.current_period_end ?? sub.created) * 1000),
      paidUntil,
      paidPlanSlug,
      included: Number(base?.price.metadata.included ?? 0),
      cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
      pendingPlanSlug: pending !== slug ? pending : null,
    };
  }
  async scheduleChange(subscriptionId: string, planSlug: string) {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: SUBSCRIPTION_EXPAND,
    });
    const base = sub.items.data.find(
      (i) => i.price.recurring?.usage_type !== 'metered',
    );
    if (!base)
      throw new BadRequestException({
        code: 'BILLING_WEBHOOK_INVALID',
        message: 'Subscription has no plan item',
      });
    const oldSchedule = stripeId(sub.schedule);
    if (planSlug === 'free' || planSlug === base.price.metadata.plan_slug) {
      if (oldSchedule)
        await this.stripe.subscriptionSchedules.release(oldSchedule);
      await this.stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: planSlug === 'free',
      });
      return;
    }
    const { base: nextBase } = await this.prices(planSlug);
    if (sub.cancel_at_period_end)
      await this.stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: false,
      });
    const scheduleId =
      oldSchedule ??
      (
        await this.stripe.subscriptionSchedules.create(
          { from_subscription: sub.id },
          {
            idempotencyKey: `corvo:schedule:${sub.id}:${base.current_period_start}`,
          },
        )
      ).id;
    await this.stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        {
          start_date: base.current_period_start,
          end_date: base.current_period_end,
          proration_behavior: 'none',
          items: sub.items.data.map((i) => ({
            price: i.price.id,
            ...(i.price.recurring?.usage_type !== 'metered'
              ? { quantity: i.quantity ?? 1 }
              : {}),
          })),
        },
        {
          duration: { interval: 'month', interval_count: 1 },
          proration_behavior: 'none',
          items: [{ price: nextBase.id, quantity: 1 }],
        },
      ],
    });
  }
  async portal(customerId: string) {
    if (!this.gateway.config.portalConfigurationId)
      throw new ServiceUnavailableException({
        code: 'BILLING_UNAVAILABLE',
        message: 'Stripe portal configuration is required',
      });
    return (
      await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        configuration: this.gateway.config.portalConfigurationId,
        // Back to the billing page (the cancel URL is `<billing>/cancel`), not the canceled-checkout page.
        return_url: this.gateway.config.checkoutCancelUrl.replace(
          /\/cancel\/?$/,
          '',
        ),
      })
    ).url;
  }
  verifyEvent(body: Buffer, signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        this.gateway.config.platformWebhookSecret,
      );
    } catch {
      throw new BadRequestException({
        code: 'BILLING_WEBHOOK_INVALID',
        message: 'Invalid Stripe signature',
      });
    }
    if (event.livemode !== this.gateway.config.secretKey.startsWith('sk_live_'))
      throw new BadRequestException({
        code: 'BILLING_WEBHOOK_INVALID',
        message: 'Stripe event mode mismatch',
      });
    let subscriptionId: string | null = null;
    let customerId: string | null = null;
    let payment: { intentId: string; paid: boolean } | null = null;
    if (event.type === 'checkout.session.completed') {
      subscriptionId = stripeId(event.data.object.subscription);
      customerId = stripeId(event.data.object.customer);
      const intentId = event.data.object.metadata?.intent_id;
      if (event.data.object.mode === 'payment' && intentId)
        payment = {
          intentId,
          paid: event.data.object.payment_status === 'paid',
        };
    } else if (
      [
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
      ].includes(event.type)
    ) {
      const sub = event.data.object as Stripe.Subscription;
      subscriptionId = sub.id;
      customerId = stripeId(sub.customer);
    } else if (
      ['invoice.paid', 'invoice.payment_failed', 'invoice.created'].includes(
        event.type,
      )
    ) {
      const invoice = event.data.object as Stripe.Invoice;
      subscriptionId = stripeId(
        invoice.parent?.subscription_details?.subscription,
      );
      customerId = stripeId(invoice.customer);
    }
    return {
      id: event.id,
      type: event.type,
      subscriptionId,
      customerId,
      payment,
    };
  }
}
