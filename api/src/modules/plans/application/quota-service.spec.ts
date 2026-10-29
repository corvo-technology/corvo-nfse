import { QuotaService } from './quota.service';

describe('QuotaService using the production implementation', () => {
  const plan = {
    active: true,
    monthlyCreditAllowance: 30,
    dailyLimit: 3,
    maxActiveCompanies: 1,
  };
  const assignments = { ensurePeriodFresh: jest.fn() };
  const credits = { status: jest.fn() };
  const companies = { countActiveByTenantId: jest.fn() };
  const query = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    getRawOne: jest.fn(),
  };
  const service = new QuotaService(
    assignments as any,
    credits as any,
    companies as any,
  );
  beforeEach(() => {
    assignments.ensurePeriodFresh.mockResolvedValue({
      plan,
      currentPeriodStart: new Date('2026-10-01'),
      currentPeriodEnd: new Date('2026-11-01'),
    });
    credits.status.mockResolvedValue({
      blocked: false,
      dailyUsage: 0,
      included_remaining: 10,
      hard_limit: 30,
      period: {
        authorized: 3,
        reserved: 2,
        included: 30,
        periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-11-01'),
      },
    });
    companies.countActiveByTenantId.mockResolvedValue(1);
    query.getCount.mockResolvedValue(0);
    query.getRawOne.mockResolvedValue({ reserved: '2', used: '3' });
  });
  it('allows emission at the company limit and rejects another live company', async () => {
    await expect(service.assertCanEmit('tenant')).resolves.toBeUndefined();
    await expect(
      service.assertCanCreateCompany('tenant'),
    ).rejects.toMatchObject({ reason: 'company_limit_exceeded' });
  });
  it('reports ledger reservation, consumption and daily usage', async () => {
    const current = await credits.status();
    credits.status.mockResolvedValue({ ...current, dailyUsage: 2 });
    expect(await service.getStatus('tenant')).toMatchObject({
      creditsReserved: 2,
      creditsUsed: 3,
      dailyUsage: 2,
      canEmit: true,
    });
  });
  it('blocks exhausted daily limits independently of companies', async () => {
    const current = await credits.status();
    credits.status.mockResolvedValue({ ...current, dailyUsage: 3 });
    await expect(service.assertCanEmit('tenant')).rejects.toMatchObject({
      reason: 'daily_limit_exceeded',
    });
  });
  it('blocks emission with no credits or an inactive plan', async () => {
    const current = (await credits.status()) as {
      period: Record<string, unknown>;
    };
    credits.status.mockResolvedValue({
      ...current,
      period: { ...current.period, authorized: 30, reserved: 0 },
    });
    await expect(service.assertCanEmit('tenant')).rejects.toMatchObject({
      reason: 'no_credits',
    });
    credits.status.mockResolvedValue({ ...current, blocked: true });
    await expect(service.assertCanEmit('tenant')).rejects.toMatchObject({
      reason: 'plan_blocked',
    });
  });
});
