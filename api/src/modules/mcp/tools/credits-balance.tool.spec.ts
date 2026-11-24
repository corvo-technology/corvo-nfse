import 'reflect-metadata';
import { createCreditsBalanceHandler } from './credits-balance.tool';

const ctx = { activeTenantId: 'tenant-1', tenantId: 'tenant-1' } as never;
const status = (over: Record<string, unknown> = {}) => ({
  blocked: false,
  included_remaining: 4,
  avulsoBalance: 6,
  hard_limit: 50,
  ...over,
});

describe('credits_balance tool', () => {
  it('sums plan and avulso notes for the authenticated workspace', async () => {
    const usageStatus = jest.fn().mockResolvedValue(status());
    const getHistoryPage = jest.fn();
    const result = await createCreditsBalanceHandler(
      { status: usageStatus },
      { getHistoryPage },
    )({}, ctx);
    expect(usageStatus).toHaveBeenCalledWith('tenant-1');
    expect(result).toEqual({
      balance: 10,
      plan_remaining: 4,
      avulso_balance: 6,
      hard_limit: 50,
    });
    expect(getHistoryPage).not.toHaveBeenCalled();
  });

  it('ignores plan notes when the plan lapsed', async () => {
    const result = await createCreditsBalanceHandler(
      {
        status: jest.fn().mockResolvedValue(status({ blocked: true })),
      },
      { getHistoryPage: jest.fn() },
    )({}, ctx);
    expect(result).toMatchObject({ balance: 6, plan_remaining: 0 });
  });

  it('returns the paginated history on request, scoped to the tenant', async () => {
    const getHistoryPage = jest.fn().mockResolvedValue({
      data: [{ id: 'tx-1' }],
      pagination: { nextCursor: 'next' },
    });
    const result = await createCreditsBalanceHandler(
      { status: jest.fn().mockResolvedValue(status()) },
      { getHistoryPage },
    )({ include_history: true, limit: 5, cursor: 'abc' }, ctx);
    expect(getHistoryPage).toHaveBeenCalledWith('tenant-1', {
      limit: 5,
      cursor: 'abc',
    });
    expect(result).toMatchObject({
      history: [{ id: 'tx-1' }],
      next_cursor: 'next',
    });
  });

  it('rejects an out-of-range limit', async () => {
    await expect(
      createCreditsBalanceHandler({} as never, {} as never)(
        { limit: 1000 },
        ctx,
      ),
    ).rejects.toThrow(/Invalid input: limit/);
  });
});
