import { NoopCreditTransactionRepository } from './noop-credit-transaction.repository';

describe('NoopCreditTransactionRepository', () => {
  const repo = new NoopCreditTransactionRepository();

  it('has no reservation to find or confirm and an empty balance', async () => {
    await expect(repo.findByReservedInvoiceId()).resolves.toBeNull();
    await expect(repo.confirm()).resolves.toBeUndefined();
    await expect(repo.calculateBalance()).resolves.toBe(0);
    await expect(repo.findByTenantId()).resolves.toEqual([]);
  });

  it('accepts a save without persisting anything', async () => {
    const saved = await repo.save({
      tenantId: 't',
      amount: -1,
      type: 'invoice_authorized',
      createdAt: new Date(),
    });
    expect(saved.amount).toBe(-1);
  });
});
