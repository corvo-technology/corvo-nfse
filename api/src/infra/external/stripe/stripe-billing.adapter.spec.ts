import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PricingService } from '@/modules/plans/application/pricing.service';
import { StripeGateway, BILLING_API_VERSION } from './stripe.gateway';
import { StripeBillingAdapter } from './stripe-billing.adapter';

const secret = 'whsec_billing_fixture';
function configuration() {
  return {
    enabled: true,
    secretKey: 'sk_test_fixture',
    platformWebhookSecret: secret,
    portalConfigurationId: 'bpc_fixture',
    checkoutSuccessUrl: 'https://corvo.test/app/billing/success',
    checkoutCancelUrl: 'https://corvo.test/app/billing/cancel',
  };
}

describe('Stripe billing adapter', () => {
  it('validates the raw signed body and test/live mode using the official SDK', () => {
    const stripe = new Stripe('sk_test_fixture', {
      apiVersion: BILLING_API_VERSION,
    });
    const adapter = new StripeBillingAdapter(
      new StripeGateway(new ConfigService({ stripe: configuration() })),
      new PricingService(),
    );
    const payload = JSON.stringify({
      id: 'evt_fixture',
      type: 'invoice.paid',
      livemode: false,
      data: {
        object: {
          customer: 'cus_fixture',
          parent: { subscription_details: { subscription: 'sub_fixture' } },
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect(adapter.verifyEvent(Buffer.from(payload), signature)).toMatchObject({
      id: 'evt_fixture',
      customerId: 'cus_fixture',
      subscriptionId: 'sub_fixture',
    });
    expect(() =>
      adapter.verifyEvent(Buffer.from(payload + ' '), signature),
    ).toThrow('Invalid Stripe signature');
    const live = payload.replace('"livemode":false', '"livemode":true');
    expect(() =>
      adapter.verifyEvent(
        Buffer.from(live),
        stripe.webhooks.generateTestHeaderString({ payload: live, secret }),
      ),
    ).toThrow('mode mismatch');
  });
  it('creates hosted monthly checkout with server-owned BRL prices and a metered excess item', async () => {
    const config = configuration();
    const create = jest.fn().mockResolvedValue({
      id: 'cs_fixture',
      url: 'https://checkout.stripe.com/test',
      expires_at: 1800000000,
      status: 'open',
      payment_status: 'unpaid',
      customer: 'cus_fixture',
      subscription: null,
    });
    const prices = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'price_base',
          lookup_key: 'corvo_developer_monthly',
          currency: 'brl',
          unit_amount: 2990,
          recurring: { interval: 'month', usage_type: 'licensed' },
          metadata: { plan_slug: 'developer' },
        },
        {
          id: 'price_excess',
          lookup_key: 'corvo_developer_overage',
          currency: 'brl',
          unit_amount: 15,
          recurring: { interval: 'month', usage_type: 'metered' },
          metadata: { plan_slug: 'developer' },
        },
      ],
    });
    const adapter = new StripeBillingAdapter(
      {
        config,
        stripe: {
          prices: { list: prices },
          checkout: { sessions: { create } },
        },
      } as unknown as StripeGateway,
      new PricingService(),
    );
    expect(
      await adapter.createCheckout(
        'cus_fixture',
        'tenant',
        'developer',
        'intent',
      ),
    ).toMatchObject({ id: 'cs_fixture' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        ui_mode: 'hosted_page',
        allowed_payment_method_types: ['card'],
        branding_settings: expect.objectContaining({
          display_name: 'Corvo',
          background_color: '#0a0a0a',
          button_color: '#3fd6a8',
          logo: expect.objectContaining({ type: 'url' }) as unknown,
        }) as unknown,
        line_items: [
          { price: 'price_base', quantity: 1 },
          { price: 'price_excess' },
        ],
        success_url:
          'https://corvo.test/app/billing/success?session_id={CHECKOUT_SESSION_ID}',
      }),
      { idempotencyKey: 'corvo:checkout:intent' },
    );
    prices.mockResolvedValueOnce({ data: [] });
    await expect(
      adapter.createCheckout('cus_fixture', 'tenant', 'developer', 'intent2'),
    ).rejects.toThrow('must be provisioned');
  });
  it('resolves v2 catalog prices by lookup_key and rejects prices that do not match the catalog', async () => {
    const price = (
      id: string,
      lookup: string,
      amount: number,
      usage: 'licensed' | 'metered',
    ) => ({
      id,
      lookup_key: lookup,
      currency: 'brl',
      unit_amount: amount,
      recurring: { interval: 'month', usage_type: usage },
      metadata: { plan_slug: 'pro' },
    });
    const list = jest.fn().mockResolvedValue({
      data: [
        price('price_pro', 'corvo_pro_monthly', 9990, 'licensed'),
        price('price_pro_excess', 'corvo_pro_overage', 8, 'metered'),
      ],
    });
    const create = jest.fn().mockResolvedValue({
      id: 'cs_pro',
      url: 'https://checkout.stripe.com/pro',
      expires_at: 1800000000,
      status: 'open',
      payment_status: 'unpaid',
      customer: 'cus_fixture',
      subscription: null,
    });
    const adapter = new StripeBillingAdapter(
      {
        config: configuration(),
        stripe: {
          prices: { list },
          checkout: { sessions: { create } },
        },
      } as unknown as StripeGateway,
      new PricingService(),
    );
    await adapter.createCheckout('cus_fixture', 'tenant', 'pro', 'intent-pro');
    expect(list).toHaveBeenCalledWith({
      lookup_keys: ['corvo_pro_monthly', 'corvo_pro_overage'],
      active: true,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          { price: 'price_pro', quantity: 1 },
          { price: 'price_pro_excess' },
        ],
      }),
      { idempotencyKey: 'corvo:checkout:intent-pro' },
    );
    // A stale Stripe price (old Growth amount under the new lookup_key) is refused, never charged.
    list.mockResolvedValueOnce({
      data: [
        price('price_stale', 'corvo_pro_monthly', 8990, 'licensed'),
        price('price_pro_excess', 'corvo_pro_overage', 8, 'metered'),
      ],
    });
    await expect(
      adapter.createCheckout('cus_fixture', 'tenant', 'pro', 'intent-stale'),
    ).rejects.toThrow('must be provisioned');
  });
  it('schedules a grandfathered legacy subscription onto a v2 plan without touching the current phase prices', async () => {
    const legacySub = {
      id: 'sub_legacy',
      schedule: null,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: {
              id: 'price_growth',
              recurring: { interval: 'month', usage_type: 'licensed' },
              metadata: { plan_slug: 'growth', kind: 'base' },
            },
            quantity: 1,
            current_period_start: 1790000000,
            current_period_end: 1792600000,
          },
          {
            price: {
              id: 'price_growth_excess',
              recurring: { interval: 'month', usage_type: 'metered' },
              metadata: { plan_slug: 'growth', kind: 'overage' },
            },
          },
        ],
      },
    };
    const update = jest.fn().mockResolvedValue({});
    const adapter = new StripeBillingAdapter(
      {
        config: configuration(),
        stripe: {
          subscriptions: {
            retrieve: jest.fn().mockResolvedValue(legacySub),
            update: jest.fn(),
          },
          subscriptionSchedules: {
            create: jest.fn().mockResolvedValue({ id: 'sub_sched' }),
            update,
          },
          prices: {
            list: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'price_dev',
                  lookup_key: 'corvo_dev_monthly',
                  currency: 'brl',
                  unit_amount: 2990,
                  recurring: { interval: 'month', usage_type: 'licensed' },
                  metadata: { plan_slug: 'dev' },
                },
                {
                  id: 'price_dev_excess',
                  lookup_key: 'corvo_dev_overage',
                  currency: 'brl',
                  unit_amount: 12,
                  recurring: { interval: 'month', usage_type: 'metered' },
                  metadata: { plan_slug: 'dev' },
                },
              ],
            }),
          },
        },
      } as unknown as StripeGateway,
      new PricingService(),
    );
    await adapter.scheduleChange('sub_legacy', 'dev');
    const phases = (
      update.mock.calls[0] as [string, { phases: { items: unknown[] }[] }]
    )[1].phases;
    expect(phases[0].items).toEqual([
      { price: 'price_growth', quantity: 1 },
      { price: 'price_growth_excess' },
    ]);
    expect(phases[1].items).toEqual([
      { price: 'price_dev', quantity: 1 },
      { price: 'price_dev_excess' },
    ]);
  });
  it('recovers a dedicated late-usage invoice and finalizes it after cancellation', async () => {
    const invoice = {
      id: 'in_late',
      status: 'draft',
      metadata: { usage_report_id: 'report' },
    };
    const createInvoice = jest.fn().mockResolvedValue(invoice);
    const createItem = jest.fn().mockResolvedValue({ id: 'ii_late' });
    const finalize = jest
      .fn()
      .mockResolvedValue({ ...invoice, status: 'open' });
    async function* invoices() {
      yield invoice;
    }
    async function* items() {
      yield { metadata: { usage_report_id: 'report' } };
    }
    const adapter = new StripeBillingAdapter(
      {
        stripe: {
          invoices: {
            list: invoices,
            create: createInvoice,
            finalizeInvoice: finalize,
          },
          invoiceItems: { list: items, create: createItem },
        },
      } as unknown as StripeGateway,
      new PricingService(),
    );
    await adapter.reportInvoiceItem({
      id: 'report',
      customerId: 'cus',
      invoiceId: 'in_origin',
      units: 10,
      unitCents: 15,
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-11-01'),
    });
    expect(createInvoice).not.toHaveBeenCalled();
    expect(createItem).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(
      'in_late',
      { auto_advance: true },
      { idempotencyKey: 'finalize:report' },
    );
  });
  it('disables API access cleanly when billing credentials are missing', () => {
    const gateway = new StripeGateway(
      new ConfigService({ stripe: { enabled: true, secretKey: '' } }),
    );
    expect(gateway.enabled).toBe(false);
    expect(() => gateway.stripe).toThrow('not configured');
  });
});
