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
  const plans = { findBySlug: jest.fn() };
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
    plans as any,
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
      avulsoBalance: 0,
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
  it('counts avulso and bonus notes when the plan allowance is spent', async () => {
    const current = (await credits.status()) as {
      period: Record<string, unknown>;
    };
    credits.status.mockResolvedValue({
      ...current,
      included_remaining: 0,
      avulsoBalance: 1012,
      period: { ...current.period, included: 0, authorized: 0, reserved: 0 },
      hard_limit: 0,
    });
    await expect(service.assertCanEmit('tenant')).resolves.toBeUndefined();
    expect(await service.getStatus('tenant')).toMatchObject({
      canEmit: true,
      creditsRemaining: 0,
      avulsoBalance: 1012,
    });
  });
  it('still blocks with the allowance spent and no avulso balance', async () => {
    const current = (await credits.status()) as {
      period: Record<string, unknown>;
    };
    credits.status.mockResolvedValue({
      ...current,
      avulsoBalance: 0,
      hard_limit: 0,
      period: { ...current.period, included: 0, authorized: 0, reserved: 0 },
    });
    await expect(service.assertCanEmit('tenant')).rejects.toMatchObject({
      reason: 'no_credits',
    });
  });
  it('lets a lapsed plan with avulso emit, and caps companies at the free plan', async () => {
    const current = (await credits.status()) as { period: object };
    credits.status.mockResolvedValue({
      ...current,
      blocked: true,
      avulsoBalance: 10,
    });
    plans.findBySlug.mockResolvedValue({ maxActiveCompanies: 1 });
    assignments.ensurePeriodFresh.mockResolvedValue({
      plan: { ...plan, maxActiveCompanies: 5 },
    });
    companies.countActiveByTenantId.mockResolvedValue(1);
    await expect(service.assertCanEmit('tenant')).resolves.toBeUndefined();
    expect(await service.getStatus('tenant')).toMatchObject({
      canEmit: true,
      reason: undefined,
      maxActiveCompanies: 1,
    });
    await expect(
      service.assertCanCreateCompany('tenant'),
    ).rejects.toMatchObject({ reason: 'company_limit_exceeded' });
    companies.countActiveByTenantId.mockResolvedValue(0);
    await expect(
      service.assertCanCreateCompany('tenant'),
    ).resolves.toBeUndefined();
  });
  it('keeps a lapsed plan blocked without avulso', async () => {
    const current = (await credits.status()) as { period: object };
    credits.status.mockResolvedValue({
      ...current,
      blocked: true,
      avulsoBalance: 0,
    });
    await expect(service.assertCanEmit('tenant')).rejects.toMatchObject({
      reason: 'plan_blocked',
    });
  });
});
