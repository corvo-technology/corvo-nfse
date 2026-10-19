import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type {
  BillingPlan,
  BillingRepository,
} from '../domain/billing.repository';
import type { BillingProvider } from '../domain/billing-provider.port';
import { BillingService } from './billing.service';

function plan(slug: string): BillingPlan {
  return {
    id: `plan-${slug}`,
    slug,
    name: slug,
    active: true,
    monthlyCreditAllowance: 100,
    creditUnitPriceCents: 10,
    dailyLimit: null,
    maxActiveCompanies: 10,
  };
}

function build() {
  const plans = new Map(
    ['free', 'dev', 'pro', 'escala'].map((slug) => [slug, plan(slug)]),
  );
  const repository = {
    locked: jest.fn((_tenantId: string, work: () => Promise<unknown>) =>
      work(),
    ),
    plan: jest.fn(async (slug: string) => plans.get(slug) ?? null),
  };
  const provider = { scheduleChange: jest.fn() };
  const service = new BillingService(
    {} as TenantWorkDiscovery,
    repository as unknown as BillingRepository,
    provider as unknown as BillingProvider,
  );
  return { service, provider };
}

describe('BillingService.checkout plan validation', () => {
  it.each(['free', 'developer', 'growth', 'scale', 'volume'])(
    'rejects checkout for a non-paid or unknown slug: %s',
    async (slug) => {
      const { service, provider } = build();
      await expect(
        service.checkout('tenant-1', slug, 'key-1'),
      ).rejects.toMatchObject({ code: 'invalid_checkout_plan' });
      expect(provider.scheduleChange).not.toHaveBeenCalled();
    },
  );
});
