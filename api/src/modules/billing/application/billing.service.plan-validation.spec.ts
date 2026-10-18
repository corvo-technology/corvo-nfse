import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type {
  BillingPlan,
  BillingRepository,
} from '../domain/billing.repository';
import type { BillingProvider } from '../domain/billing-provider.port';
import { BillingService } from './billing.service';

function plan(slug: string, overrides: Partial<BillingPlan> = {}): BillingPlan {
  return {
    id: `plan-${slug}`,
    slug,
    name: slug,
    active: true,
    monthlyCreditAllowance: 100,
    creditUnitPriceCents: 10,
    dailyLimit: null,
    maxActiveCompanies: 10,
    ...overrides,
  };
}

function build(options: { currentPlanSlug?: string } = {}) {
  const currentPlanSlug = options.currentPlanSlug ?? 'growth';
  const plans = new Map<string, BillingPlan>([
    ['free', plan('free')],
    ['dev', plan('dev')],
    ['pro', plan('pro')],
    ['escala', plan('escala')],
    ['developer', plan('developer')],
    ['growth', plan('growth')],
    ['scale', plan('scale')],
    ['volume', plan('volume')],
  ]);
  const repository = {
    locked: jest.fn((_tenantId: string, work: () => Promise<unknown>) =>
      work(),
    ),
    plan: jest.fn(async (slug: string) => plans.get(slug) ?? null),
    billing: jest.fn().mockResolvedValue({
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      pendingPlanSlug: null,
    }),
    saveBilling: jest.fn().mockResolvedValue(undefined),
    setPlan: jest.fn().mockResolvedValue(undefined),
    current: jest.fn().mockResolvedValue({
      plan: { ...plan(currentPlanSlug), slug: currentPlanSlug },
      period: { authorized: 1, reserved: 0, reported: 0 },
    }),
  };
  const provider = {
    scheduleChange: jest.fn().mockResolvedValue(undefined),
    subscription: jest.fn().mockResolvedValue({
      id: 'sub_1',
      customerId: 'cus_1',
      status: 'active',
      planSlug: currentPlanSlug,
      cancelAtPeriodEnd: false,
      pendingPlanSlug: null,
    }),
  };
  const service = new BillingService(
    {} as TenantWorkDiscovery,
    repository as unknown as BillingRepository,
    provider as unknown as BillingProvider,
  );
  return { service, repository, provider };
}

describe('BillingService.checkout plan validation', () => {
  it.each(['free', 'developer', 'growth', 'scale', 'volume'])(
    'rejects checkout for a non-catalog slug: %s',
    async (slug) => {
      const { service, provider } = build();
      await expect(
        service.checkout('tenant-1', slug, 'key-1'),
      ).rejects.toMatchObject({ code: 'invalid_checkout_plan' });
      expect(provider.scheduleChange).not.toHaveBeenCalled();
    },
  );
});

describe('BillingService.changePlan legacy guard', () => {
  it('rejects a legacy target that is not the current plan', async () => {
    const { service } = build({ currentPlanSlug: 'free' });
    await expect(
      service.changePlan('tenant-1', 'growth'),
    ).rejects.toMatchObject({ code: 'invalid_plan' });
  });

  it('allows a legacy target equal to the current plan (undo scheduled cancellation)', async () => {
    const { service, provider } = build({ currentPlanSlug: 'growth' });
    await service.changePlan('tenant-1', 'growth');
    expect(provider.scheduleChange).toHaveBeenCalledWith('sub_1', 'growth');
  });

  it('allows switching to a catalog plan regardless of current legacy plan', async () => {
    const { service, provider } = build({ currentPlanSlug: 'growth' });
    await service.changePlan('tenant-1', 'pro');
    expect(provider.scheduleChange).toHaveBeenCalledWith('sub_1', 'pro');
  });
});
