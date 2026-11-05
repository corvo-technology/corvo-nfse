import { BillingUsageService } from './billing-usage.service';
import type { BillingRepository } from '../domain/billing.repository';
import type { BillingPeriodState } from '../domain/billing-period';

const NOW = new Date();
const FUTURE = new Date(NOW.getTime() + 10 * 86_400_000);

function setup(
  opts: {
    included?: number;
    authorized?: number;
    avulso?: number;
    planSlug?: string;
    status?: string | null;
    paidUntil?: Date | null;
  } = {},
) {
  const period: BillingPeriodState = {
    id: 'period',
    tenantId: 'tenant',
    planSlug: opts.planSlug ?? 'solo',
    periodStart: new Date(NOW.getTime() - 86_400_000),
    periodEnd: FUTURE,
    included: opts.included ?? 100,
    authorized: opts.authorized ?? 0,
    reserved: 0,
    customerId: null,
    subscriptionId: null,
  };
  const repository = {
    locked: jest.fn(async (_t: string, work: () => Promise<unknown>) => work()),
    current: jest.fn().mockResolvedValue({
      plan: {
        slug: period.planSlug,
        active: true,
        dailyLimit: null,
      },
      billing: {
        stripeStatus: opts.status === undefined ? 'active' : opts.status,
        paidUntil: opts.paidUntil === undefined ? FUTURE : opts.paidUntil,
      },
      period,
    }),
    dailyUsage: jest.fn().mockResolvedValue(0),
    savePeriod: jest.fn().mockResolvedValue(undefined),
    avulsoBalance: jest.fn().mockResolvedValue(opts.avulso ?? 0),
  };
  return {
    repository,
    period,
    service: new BillingUsageService(
      repository as unknown as BillingRepository,
    ),
  };
}

describe('BillingUsageService.reserve', () => {
  it('uses the plan quota first and leaves the avulso balance alone', async () => {
    const { service, repository, period } = setup({ avulso: 5 });
    await expect(service.reserve('tenant')).resolves.toBe('period');
    expect(period.reserved).toBe(1);
    expect(repository.avulsoBalance).not.toHaveBeenCalled();
  });

  it('falls back to the avulso pool (null period) when the plan quota is spent', async () => {
    const { service, period } = setup({ authorized: 100, avulso: 2 });
    await expect(service.reserve('tenant')).resolves.toBeNull();
    expect(period.reserved).toBe(0);
  });

  it('blocks with monthly_limit_exceeded when quota and avulso are both empty', async () => {
    const { service } = setup({ authorized: 100, avulso: 0 });
    await expect(service.reserve('tenant')).rejects.toMatchObject({
      code: 'monthly_limit_exceeded',
    });
  });

  it('keeps avulso usable when the paid plan lapsed', async () => {
    const { service } = setup({
      status: 'canceled',
      paidUntil: new Date(NOW.getTime() - 30 * 86_400_000),
      avulso: 1,
    });
    await expect(service.reserve('tenant')).resolves.toBeNull();
  });

  it('reports plan_blocked when the plan lapsed and there is no avulso balance', async () => {
    const { service } = setup({
      status: 'canceled',
      paidUntil: new Date(NOW.getTime() - 30 * 86_400_000),
      avulso: 0,
    });
    await expect(service.reserve('tenant')).rejects.toMatchObject({
      code: 'plan_blocked',
    });
  });

  it('serialises the decision under the tenant lock', async () => {
    const { service, repository } = setup();
    await service.reserve('tenant');
    expect(repository.locked).toHaveBeenCalledWith(
      'tenant',
      expect.any(Function),
    );
  });

  it('exposes the avulso balance in status', async () => {
    const { service } = setup({ avulso: 7, authorized: 100 });
    await expect(service.status('tenant')).resolves.toMatchObject({
      included_remaining: 0,
      avulsoBalance: 7,
    });
  });
});
