import { ServiceUnavailableException } from '@nestjs/common';
import { CheckoutRouterService } from './checkout-router.service';

const tenant = '11111111-1111-4111-8111-111111111111';
const pixResult = { method: 'pix', brCode: 'BR', paymentLinkUrl: 'u' };

function setup(wooviEnabled = true) {
  const woovi = {
    startAvulso: jest.fn().mockResolvedValue(pixResult),
    startPlan: jest.fn().mockResolvedValue(pixResult),
  };
  const stripe = {
    start: jest.fn().mockResolvedValue({ method: 'card', url: 'https://s/1' }),
  };
  const billing = {
    checkout: jest.fn().mockResolvedValue({ url: 'https://s/sub' }),
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
  );
  return { service, woovi, stripe, billing };
}

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
});
