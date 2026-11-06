import { BillingController } from './billing.controller';
import { PricingService } from '@/modules/plans/application/pricing.service';

const req = { authContext: { activeTenantId: 'tenant-1' } } as never;

function build(
  plan: { slug: string; name: string },
  pixState: unknown = null,
  stripeCustomerId: string | null = null,
  stripeSubscriptionId: string | null = null,
) {
  const quota = {
    getStatus: jest.fn().mockResolvedValue({
      creditsUsed: 0,
      creditsReserved: 0,
      creditsRemaining: 0,
      monthlyAllowance: 0,
      dailyUsage: 0,
      dailyLimit: null,
      activeCompanies: 0,
      maxActiveCompanies: 999999,
    }),
  };
  const planRepo = {
    findActiveByTenantId: jest.fn().mockResolvedValue({
      ...plan,
      monthlyCreditAllowance: 0,
      dailyLimit: null,
      maxActiveCompanies: 999999,
    }),
  };
  const usage = {
    status: jest.fn().mockResolvedValue({
      billing: stripeCustomerId
        ? { stripeCustomerId, stripeSubscriptionId: stripeSubscriptionId }
        : null,
      blocked: false,
      hard_limit: 0,
      avulsoBalance: 0,
    }),
  };
  const pix = { pixSubscriptionState: jest.fn().mockResolvedValue(pixState) };
  return new BillingController(
    quota as never,
    {} as never,
    usage as never,
    new PricingService(),
    planRepo as never,
    {} as never,
    pix as never,
    {} as never,
  );
}

describe('BillingController.getCurrentPlan', () => {
  it.each([
    ['free', 'Sem plano'],
    ['volume', 'Volume'],
    ['developer', 'Developer'],
  ])(
    'does not fail for the "%s" plan (no-plan placeholder or a retired plan): price is 0',
    async (slug, name) => {
      const out = await build({ slug, name }).getCurrentPlan(req);
      expect(out.data).toMatchObject({
        plan: { slug, monthly_price_cents: 0 },
      });
    },
  );

  it('still reports the monthly price of a current plan', async () => {
    const out = await build({ slug: 'equipe', name: 'Equipe' }).getCurrentPlan(
      req,
    );
    expect(out.data).toMatchObject({
      plan: { slug: 'equipe', monthly_price_cents: 11990 },
    });
  });

  it('exposes the Pix Automático state so the screen can resume or cancel it', async () => {
    const state = {
      status: 'pending',
      planSlug: 'equipe',
      brCode: '000201EMV',
      paymentLinkUrl: 'https://woovi.test/p',
    };
    const out = await build(
      { slug: 'free', name: 'Sem plano' },
      state,
    ).getCurrentPlan(req);
    expect(out.data).toMatchObject({
      subscription: { pix_subscription: state },
    });
  });

  it('pix_subscription is null when there is no open contract', async () => {
    const out = await build({ slug: 'free', name: 'Sem plano' }).getCurrentPlan(
      req,
    );
    expect(out.data).toMatchObject({
      subscription: { pix_subscription: null },
    });
  });

  it('tells the screen whether the Stripe portal can open (only accounts with a Stripe customer)', async () => {
    const withCard = await build(
      { slug: 'solo', name: 'Solo' },
      null,
      'cus_1',
    ).getCurrentPlan(req);
    expect(withCard.data).toMatchObject({
      subscription: { stripe_portal_available: true },
    });
    const pixOnly = await build({ slug: 'solo', name: 'Solo' }).getCurrentPlan(
      req,
    );
    expect(pixOnly.data).toMatchObject({
      subscription: { stripe_portal_available: false },
    });
  });

  it('tells a live Stripe subscription (plan changes go through Stripe) from a card customer with none', async () => {
    const live = await build(
      { slug: 'solo', name: 'Solo' },
      null,
      'cus_1',
      'sub_1',
    ).getCurrentPlan(req);
    expect(live.data).toMatchObject({
      subscription: { stripe_subscription: true },
    });
    const oneTimeCard = await build(
      { slug: 'solo', name: 'Solo' },
      null,
      'cus_1',
      null,
    ).getCurrentPlan(req);
    expect(oneTimeCard.data).toMatchObject({
      subscription: {
        stripe_subscription: false,
        stripe_portal_available: true,
      },
    });
    const pixOnly = await build({ slug: 'solo', name: 'Solo' }).getCurrentPlan(
      req,
    );
    expect(pixOnly.data).toMatchObject({
      subscription: { stripe_subscription: false },
    });
  });
});
