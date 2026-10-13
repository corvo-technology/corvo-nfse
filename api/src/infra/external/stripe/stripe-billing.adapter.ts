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
    const quote = this.pricing.calculateQuote(slug as PlanSlug);
    if (!quote.basePriceCents)
      throw new BadRequestException('Free plan does not require checkout');
    const keys = [`corvo_${slug}_monthly`, `corvo_${slug}_overage`];
    const { data } = await this.stripe.prices.list({
      lookup_keys: keys,
      active: true,
    });
    const base = data.find((p) => p.lookup_key === keys[0]);
    const overage = data.find((p) => p.lookup_key === keys[1]);
    if (
      !base ||
      !overage ||
      base.currency !== 'brl' ||
      overage.currency !== 'brl' ||
      base.unit_amount !== quote.basePriceCents ||
      overage.unit_amount !== quote.perCreditOverageCents ||
      base.recurring?.interval !== 'month' ||
      overage.recurring?.usage_type !== 'metered' ||
      base.metadata.plan_slug !== slug ||
      overage.metadata.plan_slug !== slug
    ) {
      throw new ServiceUnavailableException(
        'Stripe prices must be provisioned for the current catalog',
      );
    }
    return { base, overage };
  }
  async createCheckout(
    customerId: string,
    tenantId: string,
    planSlug: string,
    intentId: string,
  ) {
    const { base, overage } = await this.prices(planSlug);
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
        locale: 'pt-BR',
        line_items: [{ price: base.id, quantity: 1 }, { price: overage.id }],
        success_url: success
          .toString()
          .replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'),
        cancel_url: this.gateway.config.checkoutCancelUrl,
      },
      { idempotencyKey: `corvo:checkout:${intentId}` },
    );
    return this.checkoutView(session);
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
      unitCents: overage?.price.unit_amount ?? 0,
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
    if (!base) throw new BadRequestException('Subscription has no plan item');
    const oldSchedule = stripeId(sub.schedule);
    if (planSlug === 'free' || planSlug === base.price.metadata.plan_slug) {
      if (oldSchedule)
        await this.stripe.subscriptionSchedules.release(oldSchedule);
      await this.stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: planSlug === 'free',
      });
      return;
    }
    const { base: nextBase, overage } = await this.prices(planSlug);
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
          items: [{ price: nextBase.id, quantity: 1 }, { price: overage.id }],
        },
      ],
    });
  }
  async portal(customerId: string) {
    if (!this.gateway.config.portalConfigurationId)
      throw new ServiceUnavailableException(
        'Stripe portal configuration is required',
      );
    return (
      await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        configuration: this.gateway.config.portalConfigurationId,
        return_url: this.gateway.config.checkoutCancelUrl,
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
      throw new BadRequestException('Invalid Stripe signature');
    }
    if (event.livemode !== this.gateway.config.secretKey.startsWith('sk_live_'))
      throw new BadRequestException('Stripe event mode mismatch');
    let subscriptionId: string | null = null;
    let customerId: string | null = null;
    if (event.type === 'checkout.session.completed') {
      subscriptionId = stripeId(event.data.object.subscription);
      customerId = stripeId(event.data.object.customer);
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
    return { id: event.id, type: event.type, subscriptionId, customerId };
  }
  async reportRoute(subscriptionId: string, periodEnd: Date) {
    if (periodEnd > new Date())
      return { route: 'meter' as const, invoiceId: null };
    for await (const invoice of this.stripe.invoices.list({
      subscription: subscriptionId,
      limit: 100,
    })) {
      const match = invoice.lines.data.some(
        (l) => l.period.end * 1000 === periodEnd.getTime(),
      );
      if (match)
        return {
          route:
            invoice.status === 'draft'
              ? ('meter' as const)
              : ('invoice_item' as const),
          invoiceId: invoice.id,
        };
    }
    return { route: 'invoice_item' as const, invoiceId: null };
  }
  async reportMeter(input: {
    id: string;
    name: string;
    customerId: string;
    units: number;
    timestamp: number;
  }) {
    await this.stripe.billing.meterEvents.create(
      {
        event_name: input.name,
        identifier: input.id,
        timestamp: input.timestamp,
        payload: {
          stripe_customer_id: input.customerId,
          value: String(input.units),
        },
      },
      { idempotencyKey: input.id },
    );
  }
  async reportInvoiceItem(input: {
    id: string;
    customerId: string;
    invoiceId: string | null;
    units: number;
    unitCents: number;
    periodStart: Date;
    periodEnd: Date;
  }) {
    // A dedicated invoice also collects late usage after cancellation.
    // Metadata recovers both resources after the provider's idempotency window.
    let invoice: Stripe.Invoice | null = null;
    for await (const candidate of this.stripe.invoices.list({
      customer: input.customerId,
      limit: 100,
    })) {
      if (candidate.metadata?.usage_report_id === input.id) {
        invoice = candidate;
        break;
      }
    }
    invoice ??= await this.stripe.invoices.create(
      {
        customer: input.customerId,
        collection_method: 'charge_automatically',
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        metadata: {
          usage_report_id: input.id,
          origin_invoice_id: input.invoiceId ?? '',
        },
      },
      { idempotencyKey: `invoice:${input.id}` },
    );
    let exists = false;
    for await (const item of this.stripe.invoiceItems.list({
      customer: input.customerId,
      limit: 100,
    })) {
      if (item.metadata?.usage_report_id === input.id) {
        exists = true;
        break;
      }
    }
    if (!exists)
      await this.stripe.invoiceItems.create(
        {
          customer: input.customerId,
          invoice: invoice.id,
          currency: 'brl',
          amount: input.units * input.unitCents,
          description: `${input.units} excess processing units — period ${input.periodStart.toISOString()} to ${input.periodEnd.toISOString()}`,
          metadata: {
            usage_report_id: input.id,
            origin_invoice_id: input.invoiceId ?? '',
          },
          period: {
            start: Math.floor(input.periodStart.getTime() / 1000),
            end: Math.floor(input.periodEnd.getTime() / 1000),
          },
        },
        { idempotencyKey: input.id },
      );
    if (invoice.status === 'draft')
      await this.stripe.invoices.finalizeInvoice(
        invoice.id,
        { auto_advance: true },
        { idempotencyKey: `finalize:${input.id}` },
      );
  }
}
