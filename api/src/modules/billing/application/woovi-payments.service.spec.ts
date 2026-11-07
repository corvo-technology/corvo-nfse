import { ConflictException, NotFoundException } from '@nestjs/common';
import { WooviPaymentsService } from './woovi-payments.service';
import { MemoryPaymentIntentStore } from './memory-payment-intent-store.testing';
import { PaymentFulfillmentService } from './payment-fulfillment.service';
import { PricingService } from '@/modules/plans/application/pricing.service';

function setup() {
  const store = new MemoryPaymentIntentStore();
  const charges = new Map<string, { status: string; value: number }>();
  const client = {
    createCharge: jest.fn(async (i: { correlationID: string }) => ({
      correlationID: i.correlationID,
      brCode: 'BR',
      qrCodeImage: 'IMG',
      paymentLinkUrl: 'https://pay/1',
    })),
    createSubscription: jest.fn(async (i: { correlationID: string }) => ({
      correlationID: i.correlationID,
      providerId: `gid-${i.correlationID}`,
      brCode: '000201EMV',
      status: 'WAITING_AUTHORIZATION',
      paymentLinkUrl: 'https://auth/1',
    })),
    cancelSubscription: jest.fn(),
    // What Woovi itself says about a charge; defaults to "paid in full".
    getCharge: jest.fn(async (ref: string) => {
      const override = charges.get(ref);
      if (override) return override;
      const row = store.rows.find((r) => r.providerRef === ref);
      return { status: 'COMPLETED', value: row?.amountCents ?? 5990 };
    }),
  };
  const credits = {
    grantAvulso: jest.fn().mockResolvedValue({ creditsGranted: 10 }),
  };
  const eventBus = { publishBestEffort: jest.fn() };
  const activated: Array<Record<string, unknown>> = [];
  const billing = {
    locked: jest.fn(async (_t: string, work: () => Promise<unknown>) => work()),
    plan: jest.fn(async (slug: string) => ({ id: `id-${slug}`, slug })),
    setPlan: jest.fn(async () => undefined),
    saveBilling: jest.fn(async (_t: string, patch: Record<string, unknown>) => {
      activated.push(patch);
    }),
  };
  const service = new WooviPaymentsService(
    client as never,
    store,
    new PaymentFulfillmentService(
      credits as never,
      billing as never,
      eventBus as never,
    ),
    new PricingService(),
    eventBus as never,
  );
  return {
    service,
    store,
    client,
    credits,
    billing,
    activated,
    charges,
    eventBus,
  };
}

const tenant = '11111111-1111-4111-8111-111111111111';
const payer = {
  name: 'Ana Souza',
  taxID: '12345678909',
  email: 'ana@x.com',
  phone: '5511999999999',
};

describe('WooviPaymentsService.startAvulso', () => {
  it('charges units x R$ 0,99 for 24h and stores a pending intent', async () => {
    const f = setup();
    const out = await f.service.startAvulso(tenant, 10, 'key-1');
    expect(f.client.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({ valueCents: 990, expiresInSeconds: 86400 }),
    );
    expect(out).toMatchObject({ method: 'pix', brCode: 'BR' });
    expect(f.store.rows[0]).toMatchObject({
      kind: 'avulso',
      units: 10,
      amountCents: 990,
      status: 'pending',
    });
  });
  it('rejects fewer than 3 notes before calling Woovi', async () => {
    const f = setup();
    await expect(f.service.startAvulso(tenant, 2, 'k')).rejects.toThrow(
      /minimum/i,
    );
    expect(f.client.createCharge).not.toHaveBeenCalled();
  });
  it('refuses to replay a key for a different request', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 5, 'same');
    await expect(
      f.service.startAvulso(tenant, 7, 'same'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      f.service.startPlan(tenant, 'solo', 'annual', 'same', undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.client.createCharge).toHaveBeenCalledTimes(1);
  });
  it('does not replay an expired charge: a new key is needed', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 5, 'old');
    f.store.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(
      f.service.startAvulso(tenant, 5, 'old'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('replays the same checkout for the same idempotency key', async () => {
    const f = setup();
    const a = await f.service.startAvulso(tenant, 5, 'same');
    const b = await f.service.startAvulso(tenant, 5, 'same');
    expect(b).toEqual(a);
    expect(f.client.createCharge).toHaveBeenCalledTimes(1);
  });
});

describe('WooviPaymentsService.startPlan', () => {
  it('annual plan = one charge of 12 x the monthly equivalent', async () => {
    const f = setup();
    await f.service.startPlan(tenant, 'solo', 'annual', 'k1', undefined);
    expect(f.client.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({ valueCents: 50280 }),
    );
    expect(f.store.rows[0]).toMatchObject({
      cycle: 'annual',
      amountCents: 50280,
    });
  });
  it("monthly plan uses Pix Automático, shows the QR from the emv, and remembers Woovi's id", async () => {
    const f = setup();
    const out = await f.service.startPlan(
      tenant,
      'solo',
      'monthly',
      'k3',
      payer,
    );
    expect(f.client.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ valueCents: 5990, customer: payer }),
    );
    expect(out).toMatchObject({ method: 'pix', brCode: '000201EMV' });
    expect(f.store.rows[0].checkout).toMatchObject({
      providerId: expect.stringContaining('gid-'),
    });
  });
  it.each([
    ['customer', undefined],
    ['name', { ...payer, name: ' ' }],
    ['taxID', { ...payer, taxID: '' }],
    ['email', { ...payer, email: '' }],
    ['phone', { ...payer, phone: '' }],
  ])(
    'monthly Pix refuses a payer without %s before calling Woovi',
    async (_field, customer) => {
      const f = setup();
      await expect(
        f.service.startPlan(tenant, 'solo', 'monthly', 'k2', customer as never),
      ).rejects.toThrow(/Pix Automático needs/);
      expect(f.client.createSubscription).not.toHaveBeenCalled();
    },
  );
  it('maps the Pix Automático approval and rejection events', async () => {
    const f = setup();
    await f.service.startPlan(tenant, 'solo', 'monthly', 'k4', payer);
    const ref = f.store.rows[0].providerRef;
    await f.service.handleEvent({
      event: 'PIX_AUTOMATIC_APPROVED',
      subscription: { correlationID: ref },
    });
    expect(f.store.rows[0].status).toBe('authorized');
    await f.service.handleEvent({
      event: 'PIX_AUTOMATIC_REJECTED',
      subscription: { correlationID: ref },
    });
    expect(f.store.rows[0].status).toBe('rejected');
  });
});

describe('WooviPaymentsService.handleEvent', () => {
  const completed = (ref: string, value: number) => ({
    event: 'OPENPIX:CHARGE_COMPLETED',
    charge: { correlationID: ref, value },
    pix: { value },
  });

  it('credits avulso notes once even if the webhook is delivered twice', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 10, 'k');
    const ref = f.store.rows[0].providerRef;
    await f.service.handleEvent(completed(ref, 990));
    await f.service.handleEvent(completed(ref, 990));
    expect(f.credits.grantAvulso).toHaveBeenCalledTimes(1);
    expect(f.credits.grantAvulso).toHaveBeenCalledWith(
      tenant,
      10,
      `woovi:${ref}`,
    );
  });

  it('announces the credits added, but not when the grant was a replay', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 10, 'k');
    const ref = f.store.rows[0].providerRef;
    await f.service.handleEvent(completed(ref, 990));
    expect(f.eventBus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenant,
        notice: { kind: 'credits-added', units: 10 },
      }),
    );

    const replay = setup();
    replay.credits.grantAvulso.mockResolvedValue({ creditsGranted: 0 });
    await replay.service.startAvulso(tenant, 10, 'k');
    await replay.service.handleEvent(
      completed(replay.store.rows[0].providerRef, 990),
    );
    expect(replay.eventBus.publishBestEffort).not.toHaveBeenCalled();
  });
  it('does not credit when the paid value differs from the charge', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 10, 'k');
    const ref = f.store.rows[0].providerRef;
    await f.service.handleEvent(completed(ref, 100));
    expect(f.credits.grantAvulso).not.toHaveBeenCalled();
    expect(f.store.rows[0].status).toBe('mismatch');
  });
  it('announces an unpaid Pix that expired and a payment of the wrong value, once each', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 3, 'k');
    const ref = f.store.rows[0].providerRef;
    const expired = {
      event: 'OPENPIX:CHARGE_EXPIRED',
      charge: { correlationID: ref },
    };
    await f.service.handleEvent(expired);
    await f.service.handleEvent(expired);
    expect(f.eventBus.publishBestEffort).toHaveBeenCalledTimes(1);
    expect(f.eventBus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ notice: { kind: 'pix-expired' } }),
    );

    const wrong = setup();
    await wrong.service.startAvulso(tenant, 10, 'k');
    const wrongRef = wrong.store.rows[0].providerRef;
    await wrong.service.handleEvent(completed(wrongRef, 100));
    await wrong.service.handleEvent(completed(wrongRef, 100));
    expect(wrong.eventBus.publishBestEffort).toHaveBeenCalledTimes(1);
    expect(wrong.eventBus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ notice: { kind: 'payment-mismatch' } }),
    );
  });

  it('announces a rejected or cancelled Pix Automático, once each', async () => {
    const f = setup();
    await f.service.startPlan(tenant, 'solo', 'monthly', 'k', payer);
    const sub = { correlationID: f.store.rows[0].providerRef };
    const rejected = {
      event: 'OPENPIX:SUBSCRIPTION_REJECTED',
      subscription: sub,
    };
    await f.service.handleEvent(rejected);
    await f.service.handleEvent(rejected);
    expect(f.eventBus.publishBestEffort).toHaveBeenCalledTimes(1);
    expect(f.eventBus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ notice: { kind: 'payment-failed' } }),
    );
    await f.service.handleEvent({
      event: 'OPENPIX:SUBSCRIPTION_CANCELLED',
      subscription: sub,
    });
    expect(f.eventBus.publishBestEffort).toHaveBeenLastCalledWith(
      expect.objectContaining({ notice: { kind: 'subscription-canceled' } }),
    );
  });

  it('still honors a correct payment that arrives after the charge expired', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 3, 'k');
    const ref = f.store.rows[0].providerRef;
    await f.service.handleEvent({
      event: 'OPENPIX:CHARGE_EXPIRED',
      charge: { correlationID: ref },
    });
    expect(f.store.rows[0].status).toBe('expired');
    await f.service.handleEvent(completed(ref, 297));
    expect(f.credits.grantAvulso).toHaveBeenCalledTimes(1);
  });
  it('activates an annual plan for 12 months with a monthly period', async () => {
    const f = setup();
    await f.service.startPlan(tenant, 'equipe', 'annual', 'k', undefined);
    const ref = f.store.rows[0].providerRef;
    await f.service.handleEvent(completed(ref, 100680));
    expect(f.billing.setPlan).toHaveBeenCalledWith(tenant, 'id-equipe');
    const patch = f.activated[0] as {
      stripeSubscriptionId: string | null;
      paidUntil: Date;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      stripeStatus: string;
    };
    expect(patch.stripeStatus).toBe('active');
    // Entitlement now comes from this payment, not from an old Stripe subscription.
    expect(patch).toHaveProperty('stripeSubscriptionId', null);
    const months =
      (patch.paidUntil.getUTCFullYear() -
        patch.currentPeriodStart.getUTCFullYear()) *
        12 +
      patch.paidUntil.getUTCMonth() -
      patch.currentPeriodStart.getUTCMonth();
    expect(months).toBe(12);
    expect(patch.currentPeriodEnd.getTime()).toBeLessThan(
      patch.paidUntil.getTime(),
    );
  });
  it('renews a monthly Pix Automático contract on each new cycle charge, once per charge', async () => {
    const f = setup();
    await f.service.startPlan(tenant, 'solo', 'monthly', 'k', payer);
    const sub = f.store.rows[0];
    await f.service.handleEvent({
      event: 'OPENPIX:SUBSCRIPTION_AUTHORIZED',
      subscription: { correlationID: sub.providerRef },
    });
    expect(f.store.rows[0].status).toBe('authorized');
    const cycle = {
      event: 'OPENPIX:CHARGE_COMPLETED',
      charge: {
        correlationID: 'cycle-1',
        value: 5990,
        subscription: { correlationID: sub.providerRef },
      },
      pix: { value: 5990 },
    };
    await f.service.handleEvent(cycle);
    await f.service.handleEvent(cycle);
    expect(f.billing.setPlan).toHaveBeenCalledTimes(1);
  });
  it('ignores a webhook that Woovi itself does not confirm as paid', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 10, 'k');
    const ref = f.store.rows[0].providerRef;
    f.charges.set(ref, { status: 'ACTIVE', value: 990 });
    await f.service.handleEvent(completed(ref, 990));
    expect(f.credits.grantAvulso).not.toHaveBeenCalled();
    expect(f.store.rows[0].status).toBe('pending');
  });
  it('puts the intent back to pending when delivery fails, so a redelivery retries', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 10, 'k');
    const ref = f.store.rows[0].providerRef;
    f.credits.grantAvulso.mockRejectedValueOnce(new Error('db blip'));
    await expect(f.service.handleEvent(completed(ref, 990))).rejects.toThrow(
      'db blip',
    );
    expect(f.store.rows[0].status).toBe('pending');
    await f.service.handleEvent(completed(ref, 990));
    expect(f.credits.grantAvulso).toHaveBeenCalledTimes(2);
    expect(f.store.rows[0].status).toBe('paid');
  });
  it('retries a monthly cycle whose activation failed once', async () => {
    const f = setup();
    await f.service.startPlan(tenant, 'solo', 'monthly', 'k', payer);
    const sub = f.store.rows[0];
    const cycle = {
      event: 'OPENPIX:CHARGE_COMPLETED',
      charge: {
        correlationID: 'cycle-9',
        value: 5990,
        subscription: { correlationID: sub.providerRef },
      },
      pix: { value: 5990 },
    };
    f.billing.setPlan.mockRejectedValueOnce(new Error('lock timeout'));
    await expect(f.service.handleEvent(cycle)).rejects.toThrow('lock timeout');
    await f.service.handleEvent(cycle);
    await f.service.handleEvent(cycle);
    expect(f.billing.setPlan).toHaveBeenCalledTimes(2);
  });
  it('ignores unknown charges and unknown events', async () => {
    const f = setup();
    await expect(
      f.service.handleEvent(completed('nobody', 100)),
    ).resolves.toBeUndefined();
    await expect(
      f.service.handleEvent({ event: 'OPENPIX:SOMETHING_NEW' }),
    ).resolves.toBeUndefined();
    expect(f.credits.grantAvulso).not.toHaveBeenCalled();
  });
});

describe('WooviPaymentsService Pix Automático lifecycle', () => {
  const contract = async (f: ReturnType<typeof setup>, key = 'k') => {
    await f.service.startPlan(tenant, 'solo', 'monthly', key, payer);
    return f.store.rows[f.store.rows.length - 1];
  };

  it('is null when there is no open contract', async () => {
    const f = setup();
    await expect(f.service.pixSubscriptionState(tenant)).resolves.toBeNull();
  });

  it('a new contract is "pending" and exposes the QR so the payer can open it again', async () => {
    const f = setup();
    await contract(f);
    await expect(f.service.pixSubscriptionState(tenant)).resolves.toEqual({
      status: 'pending',
      planSlug: 'solo',
      brCode: '000201EMV',
      paymentLinkUrl: expect.stringContaining('https://'),
    });
  });

  it('becomes "active" once the bank approval arrives, and stops exposing the QR', async () => {
    const f = setup();
    const sub = await contract(f);
    await f.service.handleEvent({
      event: 'OPENPIX:SUBSCRIPTION_AUTHORIZED',
      subscription: { correlationID: sub.providerRef },
    });
    await expect(f.service.pixSubscriptionState(tenant)).resolves.toEqual({
      status: 'active',
      planSlug: 'solo',
      brCode: null,
      paymentLinkUrl: null,
    });
  });

  it('becomes "active" when the first charge is paid, even without an approval event', async () => {
    const f = setup();
    const sub = await contract(f);
    await f.service.handleEvent({
      event: 'OPENPIX:CHARGE_COMPLETED',
      charge: {
        correlationID: 'cycle-1',
        value: 5990,
        subscription: { correlationID: sub.providerRef },
      },
      pix: { value: 5990 },
    });
    expect(f.store.rows.find((r) => r.id === sub.id)!.status).toBe(
      'authorized',
    );
    await expect(f.service.pixSubscriptionState(tenant)).resolves.toMatchObject(
      {
        status: 'active',
      },
    );
  });

  it('cancels every open contract in Woovi and keeps the paid period', async () => {
    const f = setup();
    const first = await contract(f, 'k1');
    f.store.rows[0].status = 'pending';
    // A second open contract (left over from an earlier attempt).
    f.store.rows.push({
      ...first,
      id: 'older',
      providerRef: 'older-ref',
      idempotencyKey: 'older-key',
      checkout: { ...first.checkout!, providerId: 'gid-older' },
    });
    await f.service.cancelPixSubscription(tenant);
    expect(f.client.cancelSubscription).toHaveBeenCalledTimes(2);
    expect(f.client.cancelSubscription).toHaveBeenCalledWith(
      `gid-${first.providerRef}`,
    );
    expect(f.client.cancelSubscription).toHaveBeenCalledWith('gid-older');
    expect(f.store.rows.every((r) => r.status === 'cancelled')).toBe(true);
    expect(f.billing.setPlan).not.toHaveBeenCalled();
    await expect(f.service.pixSubscriptionState(tenant)).resolves.toBeNull();
  });

  it('reports not found when there is no open contract', async () => {
    const f = setup();
    await expect(
      f.service.cancelPixSubscription(tenant),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.client.cancelSubscription).not.toHaveBeenCalled();
  });

  it('does not mark a contract cancelled if Woovi refuses', async () => {
    const f = setup();
    await contract(f);
    f.client.cancelSubscription.mockRejectedValueOnce(new Error('woovi down'));
    await expect(f.service.cancelPixSubscription(tenant)).rejects.toThrow(
      'woovi down',
    );
    expect(f.store.rows[0].status).toBe('pending');
  });

  it('starting a new monthly contract retires the one still waiting for authorization', async () => {
    const f = setup();
    const old = await contract(f, 'first');
    await f.service.startPlan(tenant, 'solo', 'monthly', 'second', payer);
    expect(f.client.cancelSubscription).toHaveBeenCalledWith(
      `gid-${old.providerRef}`,
    );
    expect(f.store.rows.find((r) => r.id === old.id)!.status).toBe('cancelled');
    expect(f.store.rows.filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it('still creates the new contract if retiring the old one fails (it is only a courtesy)', async () => {
    const f = setup();
    await contract(f, 'first');
    f.client.cancelSubscription.mockRejectedValueOnce(new Error('woovi down'));
    await expect(
      f.service.startPlan(tenant, 'solo', 'monthly', 'second', payer),
    ).resolves.toMatchObject({ method: 'pix' });
  });
});
