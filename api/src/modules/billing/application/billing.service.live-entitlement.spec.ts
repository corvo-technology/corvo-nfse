import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { BillingProvider } from '../domain/billing-provider.port';
import type { BillingRepository } from '../domain/billing.repository';
import { BillingService } from './billing.service';

const FUTURE = new Date(Date.now() + 10 * 86_400_000);

function build(slug: string, status: string | null, paidUntil: Date | null) {
  const repository = {
    billing: jest.fn().mockResolvedValue({ stripeStatus: status, paidUntil }),
    current: jest.fn().mockResolvedValue({ plan: { slug } }),
  };
  return new BillingService(
    {} as TenantWorkDiscovery,
    repository as unknown as BillingRepository,
    {} as BillingProvider,
  );
}

describe('BillingService.hasLiveEntitlement', () => {
  it('is true for a current paid plan that is paid and in date', async () => {
    await expect(
      build('equipe', 'active', FUTURE).hasLiveEntitlement('t'),
    ).resolves.toBe(true);
  });
  it('is false for a retired plan, even if its old subscription looks active', async () => {
    await expect(
      build('volume', 'active', FUTURE).hasLiveEntitlement('t'),
    ).resolves.toBe(false);
  });
  it('is false for no plan', async () => {
    await expect(
      build('free', 'active', FUTURE).hasLiveEntitlement('t'),
    ).resolves.toBe(false);
  });
  it('is false once the paid period (and grace) is over', async () => {
    const past = new Date(Date.now() - 30 * 86_400_000);
    await expect(
      build('solo', 'canceled', past).hasLiveEntitlement('t'),
    ).resolves.toBe(false);
  });
});
