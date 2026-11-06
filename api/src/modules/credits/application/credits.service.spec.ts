import { CreditsService } from './credits.service';

describe('CreditsService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  const buildCache = () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  });

  const buildTxRepo = (calculateBalanceReturn = 150) => ({
    save: jest.fn().mockResolvedValue(undefined),
    calculateBalance: jest.fn().mockResolvedValue(calculateBalanceReturn),
    findByTenantId: jest.fn(),
  });

  it('reads balance from the ledger and caches it on first read', async () => {
    const cache = buildCache();
    const txRepo = buildTxRepo(150);
    const service = new CreditsService(cache as never, txRepo);

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
    const service = new CreditsService(cache as never, txRepo);

    const result = await service.getBalance(tenantId);

    expect(result.balance).toBe(999);
    expect(txRepo.calculateBalance).not.toHaveBeenCalled();
  });

  it('grantAvulso credits whole notes at R$ 0,99 and records the payment ref', async () => {
    const cache = buildCache();
    const txRepo = buildTxRepo();
    const service = new CreditsService(cache as never, txRepo);

    const result = await service.grantAvulso(tenantId, 3, 'woovi:p1');

    expect(result.creditsGranted).toBe(3);
    expect(txRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        amount: 3,
        type: 'purchase',
        source: 'avulso',
        amountBrlCents: 297,
        unitPriceCentsApplied: 99,
        stripeSessionId: 'woovi:p1',
      }),
      tenantId,
    );
    expect(cache.delete).toHaveBeenCalledWith(`credit:balance:${tenantId}`);
  });

  it.each([0, 1, 2, 3.5, -4, Number.NaN])(
    'grantAvulso refuses %s notes (minimum 3, whole numbers)',
    async (units) => {
      const txRepo = buildTxRepo();
      const service = new CreditsService(buildCache() as never, txRepo);
      await expect(service.grantAvulso(tenantId, units, 'p')).rejects.toThrow(
        /minimum/i,
      );
      expect(txRepo.save).not.toHaveBeenCalled();
    },
  );

  it('grantAvulso is idempotent per payment ref (duplicate insert is not an error)', async () => {
    const txRepo = buildTxRepo();
    txRepo.save.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );
    const service = new CreditsService(buildCache() as never, txRepo);
    const result = await service.grantAvulso(tenantId, 5, 'woovi:p1');
    expect(result.creditsGranted).toBe(0);
  });

  it('grantAvulso rethrows non-duplicate failures', async () => {
    const txRepo = buildTxRepo();
    txRepo.save.mockRejectedValueOnce(new Error('db down'));
    const service = new CreditsService(buildCache() as never, txRepo);
    await expect(service.grantAvulso(tenantId, 5, 'p')).rejects.toThrow(
      'db down',
    );
  });

  it('previewPurchase prices notes at R$ 0,99 and enforces the minimum', () => {
    const service = new CreditsService(buildCache() as never, buildTxRepo());
    expect(service.previewPurchase(10)).toEqual({
      units: 10,
      unitPriceCents: 99,
      totalCents: 990,
    });
    expect(() => service.previewPurchase(2)).toThrow(/minimum/i);
  });

  it('grantBonus inserts a bonus transaction and invalidates the cache', async () => {
    const cache = buildCache();
    const txRepo = buildTxRepo();
    const service = new CreditsService(cache as never, txRepo);

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
    const service = new CreditsService(cache as never, txRepo);

    await expect(service.grantBonus(tenantId, 0, 'nothing')).rejects.toThrow(
      /non-zero/,
    );
    expect(txRepo.save).not.toHaveBeenCalled();
  });
});
