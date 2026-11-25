import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CheckoutRouterService } from './checkout-router.service';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';

const tenant = '11111111-1111-4111-8111-111111111111';
const pixResult = { method: 'pix', brCode: 'BR', paymentLinkUrl: 'u' };

function setup(wooviEnabled = true) {
  const audit = new FakeAccountAudit();
  const woovi = {
    startAvulso: jest.fn().mockResolvedValue(pixResult),
    startPlan: jest.fn().mockResolvedValue(pixResult),
  };
  const stripe = {
    start: jest.fn().mockResolvedValue({ method: 'card', url: 'https://s/1' }),
  };
  const billing = {
    checkout: jest.fn().mockResolvedValue({ url: 'https://s/sub' }),
    hasLiveEntitlement: jest.fn().mockResolvedValue(false),
  };
  const service = new CheckoutRouterService(
    woovi as never,
    stripe as never,
    billing as never,
    {
      enabled: wooviEnabled,
      appId: 'a',
      webhookToken: 't',
      apiUrl: 'x',
    },
    audit,
  );
  return { service, woovi, stripe, billing, audit };
}

describe('CheckoutRouterService audit', () => {
  it('records billing.charge_created with method, kind, units and amount, no secrets', async () => {
    const f = setup();
    f.woovi.startAvulso.mockResolvedValue({
      method: 'pix',
      brCode: 'SECRET-BR',
      paymentLinkUrl: 'https://pay/1',
      paymentId: 'pay-1',
    });
    await f.service.start(
      tenant,
      { kind: 'avulso', units: 50, method: 'pix' },
      'k',
    );
    expect(f.audit.events).toHaveLength(1);
    expect(f.audit.events[0]).toMatchObject({
      tenantId: tenant,
      environment: null,
      action: 'billing.charge_created',
      target: { type: 'payment', id: 'pay-1' },
      metadata: {
        method: 'pix',
        kind: 'avulso',
        units: 50,
        amount_cents: 4950,
      },
    });
    expect(JSON.stringify(f.audit.events)).not.toContain('SECRET-BR');
  });
  it('does not record when the provider fails', async () => {
    const f = setup();
    f.woovi.startAvulso.mockRejectedValue(new Error('boom'));
    await expect(
      f.service.start(tenant, { kind: 'avulso', units: 5, method: 'pix' }, 'k'),
    ).rejects.toThrow('boom');
    expect(f.audit.events).toHaveLength(0);
  });
});

describe('CheckoutRouterService', () => {
  it('pix + avulso -> Woovi charge', async () => {
    const f = setup();
    await expect(
      f.service.start(
        tenant,
        { kind: 'avulso', units: 10, method: 'pix' },
        'k',
      ),
    ).resolves.toBe(pixResult);
    expect(f.woovi.startAvulso).toHaveBeenCalledWith(tenant, 10, 'k');
  });
  it('pix + plan -> Woovi plan flow with cycle and payer', async () => {
    const f = setup();
    const customer = { name: 'Ana', taxID: '12345678909' };
    await f.service.start(
      tenant,
      {
        kind: 'plan',
        planSlug: 'solo',
        cycle: 'monthly',
        method: 'pix',
        customer,
      },
      'k',
    );
    expect(f.woovi.startPlan).toHaveBeenCalledWith(
      tenant,
      'solo',
      'monthly',
      'k',
      customer,
    );
  });
  it('card + avulso and card + annual -> Stripe one-time payment', async () => {
    const f = setup();
    await f.service.start(
      tenant,
      { kind: 'avulso', units: 4, method: 'card' },
      'k',
    );
    expect(f.stripe.start).toHaveBeenCalledWith(
      tenant,
      { kind: 'avulso', units: 4 },
      'k',
    );
    await f.service.start(
      tenant,
      { kind: 'plan', planSlug: 'equipe', cycle: 'annual', method: 'card' },
      'k2',
    );
    expect(f.stripe.start).toHaveBeenLastCalledWith(
      tenant,
      { kind: 'plan', planSlug: 'equipe', cycle: 'annual' },
      'k2',
    );
  });
  it('card + monthly plan -> Stripe subscription checkout', async () => {
    const f = setup();
    await expect(
      f.service.start(
        tenant,
        { kind: 'plan', planSlug: 'solo', cycle: 'monthly', method: 'card' },
        'k',
      ),
    ).resolves.toEqual({ method: 'card', url: 'https://s/sub' });
    expect(f.billing.checkout).toHaveBeenCalledWith(tenant, 'solo', 'k');
  });
  it('refuses pix when Woovi is not enabled', async () => {
    const f = setup(false);
    await expect(
      f.service.start(tenant, { kind: 'avulso', units: 5, method: 'pix' }, 'k'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.woovi.startAvulso).not.toHaveBeenCalled();
  });
  it('refuses a new plan purchase while a paid plan is still active, but still sells avulso', async () => {
    const f = setup();
    f.billing.hasLiveEntitlement.mockResolvedValue(true);
    for (const method of ['pix', 'card'] as const)
      await expect(
        f.service.start(
          tenant,
          { kind: 'plan', planSlug: 'solo', cycle: 'annual', method },
          'k',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    expect(f.woovi.startPlan).not.toHaveBeenCalled();
    expect(f.stripe.start).not.toHaveBeenCalled();
    expect(f.billing.checkout).not.toHaveBeenCalled();
    await f.service.start(
      tenant,
      { kind: 'avulso', units: 3, method: 'pix' },
      'k2',
    );
    expect(f.woovi.startAvulso).toHaveBeenCalled();
  });
  for (const [index, key] of [
    undefined,
    '',
    '   ',
    'k'.repeat(201),
  ].entries()) {
    it(`rejects the idempotency key #${index} with a 400 before anything else`, async () => {
      const f = setup();
      const attempt = f.service.start(
        tenant,
        { kind: 'avulso', units: 5, method: 'pix' },
        key as never,
      );
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      expect(f.woovi.startAvulso).not.toHaveBeenCalled();
    });
  }
});
