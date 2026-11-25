import { ConflictException } from '@nestjs/common';
import { StripePaymentsService } from './stripe-payments.service';
import { PaymentFulfillmentService } from './payment-fulfillment.service';
import { MemoryPaymentIntentStore } from './memory-payment-intent-store.testing';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { PricingService } from '@/modules/plans/application/pricing.service';

const tenant = '11111111-1111-4111-8111-111111111111';

function setup(customerId: string | null = null) {
  const store = new MemoryPaymentIntentStore();
  const provider = {
    createCustomer: jest.fn().mockResolvedValue('cus_new'),
    createPaymentCheckout: jest
      .fn()
      .mockResolvedValue({ id: 'cs_1', url: 'https://stripe.test/pay' }),
  };
  const credits = { grantAvulso: jest.fn().mockResolvedValue({}) };
  const billing = {
    billing: jest.fn().mockResolvedValue({
      stripeCustomerId: customerId,
      billingEmail: 'a@x.com',
    }),
    saveBilling: jest.fn().mockResolvedValue(undefined),
    locked: jest.fn(async (_t: string, work: () => Promise<unknown>) => work()),
    plan: jest.fn(async (slug: string) => ({ id: `id-${slug}`, slug })),
    current: jest.fn(async () => ({ plan: { id: 'id-free', slug: 'free' } })),
    setPlan: jest.fn().mockResolvedValue(undefined),
  };
  const service = new StripePaymentsService(
    provider as never,
    billing as never,
    store,
    new PaymentFulfillmentService(
      credits as never,
      billing as never,
      { publishBestEffort: jest.fn() } as never,
      new FakeAccountAudit(),
    ),
    new PricingService(),
  );
  return { service, store, provider, credits, billing };
}

describe('StripePaymentsService.start', () => {
  it('creates the customer once and charges avulso notes at R$ 0,99', async () => {
    const f = setup();
    const out = await f.service.start(
      tenant,
      { kind: 'avulso', units: 10 },
      'k1',
    );
    expect(out).toEqual({ method: 'card', url: 'https://stripe.test/pay' });
    expect(f.provider.createCustomer).toHaveBeenCalledWith(tenant, 'a@x.com');
    expect(f.billing.saveBilling).toHaveBeenCalledWith(tenant, {
      stripeCustomerId: 'cus_new',
    });
    expect(f.provider.createPaymentCheckout).toHaveBeenCalledWith(
      'cus_new',
      tenant,
      expect.objectContaining({
        amountCents: 990,
        allowPromotionCodes: false,
      }),
    );
    expect(f.store.rows[0]).toMatchObject({
      provider: 'stripe',
      kind: 'avulso',
      status: 'pending',
      checkout: { method: 'card', paymentLinkUrl: 'https://stripe.test/pay' },
    });
  });
  it('charges the annual plan at once: 12 x the monthly equivalent', async () => {
    const f = setup('cus_1');
    await f.service.start(
      tenant,
      { kind: 'plan', planSlug: 'solo', cycle: 'annual' },
      'k2',
    );
    expect(f.provider.createCustomer).not.toHaveBeenCalled();
    expect(f.provider.createPaymentCheckout).toHaveBeenCalledWith(
      'cus_1',
      tenant,
      expect.objectContaining({
        amountCents: 50280,
        allowPromotionCodes: true,
      }),
    );
  });
  it('rejects fewer than 3 notes and monthly plans (those are subscriptions)', async () => {
    const f = setup('cus_1');
    await expect(
      f.service.start(tenant, { kind: 'avulso', units: 2 }, 'k'),
    ).rejects.toThrow(/minimum/i);
    await expect(
      f.service.start(
        tenant,
        { kind: 'plan', planSlug: 'solo', cycle: 'monthly' },
        'k',
      ),
    ).rejects.toThrow(/subscription/i);
  });
  it('refuses to replay a key for a different request or provider', async () => {
    const f = setup('cus_1');
    await f.service.start(tenant, { kind: 'avulso', units: 5 }, 'same');
    await expect(
      f.service.start(tenant, { kind: 'avulso', units: 9 }, 'same'),
    ).rejects.toBeInstanceOf(ConflictException);
    f.store.rows[0].provider = 'woovi';
    await expect(
      f.service.start(tenant, { kind: 'avulso', units: 5 }, 'same'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('replays the same url for the same idempotency key', async () => {
    const f = setup('cus_1');
    const a = await f.service.start(
      tenant,
      { kind: 'avulso', units: 5 },
      'same',
    );
    const b = await f.service.start(
      tenant,
      { kind: 'avulso', units: 5 },
      'same',
    );
    expect(b).toEqual(a);
    expect(f.provider.createPaymentCheckout).toHaveBeenCalledTimes(1);
  });
});

describe('StripePaymentsService.complete', () => {
  it('credits the notes once even if the event is delivered twice', async () => {
    const f = setup('cus_1');
    await f.service.start(tenant, { kind: 'avulso', units: 10 }, 'k');
    const ref = f.store.rows[0].providerRef;
    await f.service.complete(ref);
    await f.service.complete(ref);
    expect(f.credits.grantAvulso).toHaveBeenCalledTimes(1);
    expect(f.credits.grantAvulso).toHaveBeenCalledWith(
      tenant,
      10,
      `stripe:${ref}`,
    );
  });
  it('puts the intent back to pending when delivery fails, so the redelivered event retries', async () => {
    const f = setup('cus_1');
    await f.service.start(tenant, { kind: 'avulso', units: 10 }, 'k');
    const ref = f.store.rows[0].providerRef;
    f.credits.grantAvulso.mockRejectedValueOnce(new Error('db blip'));
    await expect(f.service.complete(ref)).rejects.toThrow('db blip');
    expect(f.store.rows[0].status).toBe('pending');
    await f.service.complete(ref);
    expect(f.store.rows[0].status).toBe('paid');
  });
  it('ignores unknown intents', async () => {
    const f = setup('cus_1');
    await expect(f.service.complete('nope')).resolves.toBeUndefined();
    expect(f.credits.grantAvulso).not.toHaveBeenCalled();
  });
});

describe('StripePaymentsService.recordSubscriptionInvoice', () => {
  const paidAt = new Date('2026-11-01T12:00:00Z');
  const invoice = { id: 'in_1', amountCents: 4900, paidAt };
  it('insere linha paid stripe/plan/monthly com providerRef = invoice.id', async () => {
    const f = setup('cus_1');
    await f.service.recordSubscriptionInvoice(tenant, 'solo', invoice);
    expect(f.store.rows).toHaveLength(1);
    expect(f.store.rows[0]).toMatchObject({
      tenantId: tenant,
      kind: 'plan',
      cycle: 'monthly',
      provider: 'stripe',
      providerRef: 'in_1',
      status: 'paid',
      idempotencyKey: null,
      checkout: null,
      units: null,
      planSlug: 'solo',
      amountCents: 4900,
      paidAt,
    });
  });
  it('duplicata (23505) é ignorada', async () => {
    const f = setup('cus_1');
    await f.service.recordSubscriptionInvoice(tenant, 'solo', invoice);
    await expect(
      f.service.recordSubscriptionInvoice(tenant, 'solo', invoice),
    ).resolves.toBeUndefined();
    expect(f.store.rows).toHaveLength(1);
  });
  it('outro erro do banco é propagado', async () => {
    const f = setup('cus_1');
    jest.spyOn(f.store, 'insert').mockRejectedValueOnce(new Error('db down'));
    await expect(
      f.service.recordSubscriptionInvoice(tenant, 'solo', invoice),
    ).rejects.toThrow('db down');
  });
});
