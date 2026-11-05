import { WooviPaymentsService } from './woovi-payments.service';
import { MemoryPaymentIntentStore } from './memory-payment-intent-store.testing';
import { PaymentFulfillmentService } from './payment-fulfillment.service';
import { PricingService } from '@/modules/plans/application/pricing.service';

function setup() {
  const store = new MemoryPaymentIntentStore();
  const client = {
    createCharge: jest.fn(async (i: { correlationID: string }) => ({
      correlationID: i.correlationID,
      brCode: 'BR',
      qrCodeImage: 'IMG',
      paymentLinkUrl: 'https://pay/1',
    })),
    createSubscription: jest.fn(async (i: { correlationID: string }) => ({
      correlationID: i.correlationID,
      status: 'WAITING_AUTHORIZATION',
      paymentLinkUrl: 'https://auth/1',
    })),
    cancelSubscription: jest.fn(),
  };
  const credits = { grantAvulso: jest.fn().mockResolvedValue({}) };
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
    new PaymentFulfillmentService(credits as never, billing as never),
    new PricingService(),
  );
  return { service, store, client, credits, billing, activated };
}

const tenant = '11111111-1111-4111-8111-111111111111';

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
  it('monthly plan uses Pix Automático and needs the payer data', async () => {
    const f = setup();
    await expect(
      f.service.startPlan(tenant, 'solo', 'monthly', 'k2', undefined),
    ).rejects.toThrow(/customer/i);
    await f.service.startPlan(tenant, 'solo', 'monthly', 'k3', {
      name: 'Ana',
      taxID: '12345678909',
    });
    expect(f.client.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ valueCents: 5990 }),
    );
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
    const ref = f.store.rows[0]!.providerRef;
    await f.service.handleEvent(completed(ref, 990));
    await f.service.handleEvent(completed(ref, 990));
    expect(f.credits.grantAvulso).toHaveBeenCalledTimes(1);
    expect(f.credits.grantAvulso).toHaveBeenCalledWith(
      tenant,
      10,
      `woovi:${ref}`,
    );
  });
  it('does not credit when the paid value differs from the charge', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 10, 'k');
    const ref = f.store.rows[0]!.providerRef;
    await f.service.handleEvent(completed(ref, 100));
    expect(f.credits.grantAvulso).not.toHaveBeenCalled();
    expect(f.store.rows[0]!.status).toBe('mismatch');
  });
  it('still honors a correct payment that arrives after the charge expired', async () => {
    const f = setup();
    await f.service.startAvulso(tenant, 3, 'k');
    const ref = f.store.rows[0]!.providerRef;
    await f.service.handleEvent({
      event: 'OPENPIX:CHARGE_EXPIRED',
      charge: { correlationID: ref },
    });
    expect(f.store.rows[0]!.status).toBe('expired');
    await f.service.handleEvent(completed(ref, 297));
    expect(f.credits.grantAvulso).toHaveBeenCalledTimes(1);
  });
  it('activates an annual plan for 12 months with a monthly period', async () => {
    const f = setup();
    await f.service.startPlan(tenant, 'equipe', 'annual', 'k', undefined);
    const ref = f.store.rows[0]!.providerRef;
    await f.service.handleEvent(completed(ref, 100680));
    expect(f.billing.setPlan).toHaveBeenCalledWith(tenant, 'id-equipe');
    const patch = f.activated[0] as {
      paidUntil: Date;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      stripeStatus: string;
    };
    expect(patch.stripeStatus).toBe('active');
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
    await f.service.startPlan(tenant, 'solo', 'monthly', 'k', {
      name: 'Ana',
      taxID: '12345678909',
    });
    const sub = f.store.rows[0]!;
    await f.service.handleEvent({
      event: 'OPENPIX:SUBSCRIPTION_AUTHORIZED',
      subscription: { correlationID: sub.providerRef },
    });
    expect(f.store.rows[0]!.status).toBe('authorized');
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
