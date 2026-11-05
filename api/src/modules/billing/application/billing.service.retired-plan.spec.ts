import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { BillingProvider } from '../domain/billing-provider.port';
import type { BillingRepository } from '../domain/billing.repository';
import { BillingService } from './billing.service';

const body = Buffer.from('{"id":"evt"}');
const FUTURE = new Date(Date.now() + 20 * 86_400_000);

function build(planRow: { id: string; slug: string; active: boolean } | null) {
  const repository = {
    customerTenant: jest.fn().mockResolvedValue('tenant-1'),
    locked: jest.fn((_t: string, work: () => Promise<void>) => work()),
    lockedProviderEvent: jest.fn((_id: string, work: () => Promise<void>) =>
      work(),
    ),
    eventSeen: jest.fn().mockResolvedValue(false),
    recordEvent: jest.fn().mockResolvedValue(undefined),
    billing: jest.fn().mockResolvedValue({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    }),
    plan: jest.fn().mockResolvedValue(planRow),
    current: jest.fn().mockResolvedValue({
      plan: { id: 'plan-free', slug: 'free' },
      period: { authorized: 0, reserved: 0, included: 0 },
    }),
    setPlan: jest.fn().mockResolvedValue(undefined),
    saveBilling: jest.fn().mockResolvedValue(undefined),
    savePeriod: jest.fn().mockResolvedValue(undefined),
  };
  const provider = {
    verifyEvent: jest.fn().mockReturnValue({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    }),
    subscription: jest.fn().mockResolvedValue({
      id: 'sub_1',
      customerId: 'cus_1',
      status: 'active',
      planSlug: 'volume',
      paidPlanSlug: 'volume',
      periodStart: new Date(),
      periodEnd: FUTURE,
      paidUntil: FUTURE,
      included: 10000,
      cancelAtPeriodEnd: false,
      pendingPlanSlug: null,
    }),
  };
  const service = new BillingService(
    {} as TenantWorkDiscovery,
    repository as unknown as BillingRepository,
    provider as unknown as BillingProvider,
  );
  return { service, repository };
}

describe('BillingService: a Stripe subscription on a retired plan', () => {
  it('never moves the account back onto the retired plan', async () => {
    const f = build({ id: 'plan-volume', slug: 'volume', active: false });
    await f.service.webhook(body, 'sig');
    expect(f.repository.setPlan).not.toHaveBeenCalled();
    expect(f.repository.saveBilling).not.toHaveBeenCalled();
  });

  it('still applies a subscription on a current plan', async () => {
    const f = build({ id: 'plan-equipe', slug: 'equipe', active: true });
    await f.service.webhook(body, 'sig');
    expect(f.repository.saveBilling).toHaveBeenCalled();
  });
});
