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
  it('reads a paid one-time checkout session as a payment event', () => {
    const stripe = new Stripe('sk_test_fixture', {
      apiVersion: BILLING_API_VERSION,
    });
    const adapter = new StripeBillingAdapter(
      new StripeGateway(new ConfigService({ stripe: configuration() })),
      new PricingService(),
    );
    const event = (payment_status: string) =>
      JSON.stringify({
        id: 'evt_pay',
        type: 'checkout.session.completed',
        livemode: false,
        data: {
          object: {
            mode: 'payment',
            payment_status,
            customer: 'cus_fixture',
            subscription: null,
            metadata: { intent_id: 'intent-1', tenant_id: 't' },
          },
        },
      });
    const verify = (payload: string) =>
      adapter.verifyEvent(
        Buffer.from(payload),
        stripe.webhooks.generateTestHeaderString({ payload, secret }),
      );
    expect(verify(event('paid')).payment).toEqual({
      intentId: 'intent-1',
      paid: true,
    });
    expect(verify(event('unpaid')).payment).toEqual({
      intentId: 'intent-1',
      paid: false,
    });
  });
  it('returns from the Stripe portal to the billing page, not to the canceled-checkout page', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ url: 'https://billing.stripe.test/p' });
    const adapter = new StripeBillingAdapter(
      {
        config: configuration(),
        stripe: { billingPortal: { sessions: { create } } },
      } as unknown as StripeGateway,
      new PricingService(),
    );
    await expect(adapter.portal('cus_1')).resolves.toBe(
      'https://billing.stripe.test/p',
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        return_url: 'https://corvo.test/app/billing',
      }),
    );
  });
  it('creates a hosted one-time card checkout with server-owned amount', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'cs_pay',
      url: 'https://checkout.stripe.com/pay',
    });
    const adapter = new StripeBillingAdapter(
      {
        config: configuration(),
        stripe: { checkout: { sessions: { create } } },
      } as unknown as StripeGateway,
      new PricingService(),
    );
    await expect(
      adapter.createPaymentCheckout('cus_fixture', 'tenant', {
        name: 'Corvo: 10 notas avulsas',
        amountCents: 990,
        intentId: 'intent-1',
      }),
    ).resolves.toEqual({
      id: 'cs_pay',
      url: 'https://checkout.stripe.com/pay',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_fixture',
        allowed_payment_method_types: ['card'],
        allow_promotion_codes: true,
        metadata: { tenant_id: 'tenant', intent_id: 'intent-1' },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'brl',
              unit_amount: 990,
              product_data: { name: 'Corvo: 10 notas avulsas' },
            },
          },
        ],
      }),
      { idempotencyKey: 'corvo:pay:intent-1' },
    );
  });
  it('creates hosted monthly checkout with a single server-owned BRL base price', async () => {
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
          lookup_key: 'corvo_solo_monthly',
          currency: 'brl',
          unit_amount: 5990,
          recurring: { interval: 'month', usage_type: 'licensed' },
          metadata: { plan_slug: 'solo' },
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
      await adapter.createCheckout('cus_fixture', 'tenant', 'solo', 'intent'),
    ).toMatchObject({ id: 'cs_fixture' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        ui_mode: 'hosted_page',
        allowed_payment_method_types: ['card'],
        allow_promotion_codes: true,
        branding_settings: expect.objectContaining({
          display_name: 'Corvo',
          background_color: '#0a0a0a',
          button_color: '#3fd6a8',
          logo: expect.objectContaining({ type: 'url' }) as unknown,
        }) as unknown,
        line_items: [{ price: 'price_base', quantity: 1 }],
        success_url:
          'https://corvo.test/app/billing/success?session_id={CHECKOUT_SESSION_ID}',
      }),
      { idempotencyKey: 'corvo:checkout:intent' },
    );
    prices.mockResolvedValueOnce({ data: [] });
    await expect(
      adapter.createCheckout('cus_fixture', 'tenant', 'solo', 'intent2'),
    ).rejects.toThrow('must be provisioned');
  });
  describe('invoice.paid', () => {
    function verify(invoice: Record<string, unknown>) {
      const stripe = new Stripe('sk_test_fixture', {
        apiVersion: BILLING_API_VERSION,
      });
      const adapter = new StripeBillingAdapter(
        new StripeGateway(new ConfigService({ stripe: configuration() })),
        new PricingService(),
      );
      const payload = JSON.stringify({
        id: 'evt_inv',
        type: 'invoice.paid',
        livemode: false,
        data: { object: { customer: 'cus_fixture', ...invoice } },
      });
      return adapter.verifyEvent(
        Buffer.from(payload),
        stripe.webhooks.generateTestHeaderString({ payload, secret }),
      );
    }
    const parent = { subscription_details: { subscription: 'sub_fixture' } };
    it('invoice.paid com assinatura expõe id, valor e data', () => {
      const event = verify({
        id: 'in_1',
        amount_paid: 4900,
        parent,
        status_transitions: { paid_at: 1_700_000_000 },
      });
      expect(event.invoice).toEqual({
        id: 'in_1',
        amountCents: 4900,
        paidAt: new Date(1_700_000_000_000),
      });
    });
    it('invoice.paid de valor zero ou sem assinatura não expõe invoice', () => {
      const paid = { status_transitions: { paid_at: 1_700_000_000 } };
      expect(
        verify({ id: 'in_0', amount_paid: 0, parent, ...paid }).invoice,
      ).toBeNull();
      expect(
        verify({ id: 'in_2', amount_paid: 4900, parent: null, ...paid })
          .invoice,
      ).toBeNull();
    });
  });
  it('disables API access cleanly when billing credentials are missing', () => {
    const gateway = new StripeGateway(
      new ConfigService({ stripe: { enabled: true, secretKey: '' } }),
    );
    expect(gateway.enabled).toBe(false);
    expect(() => gateway.stripe).toThrow('not configured');
  });
});
