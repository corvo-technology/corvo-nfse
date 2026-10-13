import { CreditsService } from './credits.service';

describe('CreditsService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const freePlanId = 'free-plan-uuid';

  const buildCache = () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  });

  const buildPlanRepo = (overrides: Record<string, unknown> = {}) => ({
    findActiveByTenantId: jest.fn().mockResolvedValue({
      id: freePlanId,
      slug: 'free',
      name: 'Free',
      monthlyPriceCents: 0,
      creditUnitPriceCents: 8,
      throughputRps: 10,
      active: true,
      ...overrides,
    }),
  });

  const buildTxRepo = (calculateBalanceReturn = 150) => ({
    save: jest.fn(),
    calculateBalance: jest.fn().mockResolvedValue(calculateBalanceReturn),
    findByTenantId: jest.fn(),
  });

  it('reads balance from the ledger and caches it on first read', async () => {
    const cache = buildCache();
    const txRepo = buildTxRepo(150);
    const planRepo = buildPlanRepo();
    const service = new CreditsService(
      cache as never,
      txRepo,
      planRepo as never,
    );

    const result = await service.getBalance(tenantId);

    expect(result).toEqual({ tenantId, balance: 150 });
    expect(txRepo.calculateBalance).toHaveBeenCalledWith(tenantId);
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalledWith(
      `credit:balance:${tenantId}`,
      { tenantId, balance: 150 },
      expect.objectContaining({ ttlSeconds: expect.any(Number) }),
    );
  });

  it('returns cached balance without hitting the ledger', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue({ tenantId, balance: 999 }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const txRepo = buildTxRepo();
    const planRepo = buildPlanRepo();
    const service = new CreditsService(
      cache as never,
      txRepo,
      planRepo as never,
    );

    const result = await service.getBalance(tenantId);

    expect(result.balance).toBe(999);
    expect(txRepo.calculateBalance).not.toHaveBeenCalled();
  });

  it('purchaseCredits grants floor(amount/unitPrice) credits and snapshots the plan', async () => {
    const cache = buildCache();
    const txRepo = buildTxRepo();
    const planRepo = buildPlanRepo({ creditUnitPriceCents: 5 });
    const service = new CreditsService(
      cache as never,
      txRepo,
      planRepo as never,
    );

    // R$ 10 with Developer plan (R$ 0,05/credit) = floor(1000/5) = 200 credits
    const result = await service.purchaseCredits(tenantId, 1000, 'avulso');

    expect(result.creditsGranted).toBe(200);
    expect(result.unitPriceCents).toBe(5);
    expect(txRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        amount: 200,
        type: 'purchase',
        amountBrlCents: 1000,
        unitPriceCentsApplied: 5,
        planIdSnapshot: freePlanId,
        source: 'avulso',
      }),
      tenantId,
    );
    expect(cache.delete).toHaveBeenCalled();
  });

  it('purchaseCredits refuses avulso under R$ 10', async () => {
    const cache = buildCache();
    const txRepo = buildTxRepo();
    const planRepo = buildPlanRepo();
    const service = new CreditsService(
      cache as never,
      txRepo,
      planRepo as never,
    );

    await expect(
      service.purchaseCredits(tenantId, 500, 'avulso'),
    ).rejects.toThrow(/R\$ 10/);
    expect(txRepo.save).not.toHaveBeenCalled();
  });

  it('grantBonus inserts a bonus transaction and invalidates the cache', async () => {
    const cache = buildCache();
    const txRepo = buildTxRepo();
    const planRepo = buildPlanRepo();
    const service = new CreditsService(
      cache as never,
      txRepo,
      planRepo as never,
    );

    await service.grantBonus(tenantId, 50, 'Signup bonus');

    expect(txRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        amount: 50,
        type: 'bonus',
        source: 'bonus',
        description: 'Signup bonus',
      }),
      tenantId,
    );
    expect(cache.delete).toHaveBeenCalledWith(`credit:balance:${tenantId}`);
  });

  it('grantBonus rejects zero-amount', async () => {
    const cache = buildCache();
    const txRepo = buildTxRepo();
    const planRepo = buildPlanRepo();
    const service = new CreditsService(
      cache as never,
      txRepo,
      planRepo as never,
    );

    await expect(service.grantBonus(tenantId, 0, 'nothing')).rejects.toThrow(
      /non-zero/,
    );
    expect(txRepo.save).not.toHaveBeenCalled();
  });
});
