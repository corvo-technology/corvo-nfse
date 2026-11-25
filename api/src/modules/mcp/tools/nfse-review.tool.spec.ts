import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createNfseReviewHandler } from './nfse-review.tool';

const ctx = {
  activeTenantId: 'tenant-1',
  authUserId: 'auth-1',
  mcpConnectionId: 'conn-1',
  executionEnvironment: 'live',
} as unknown as AuthContext;
const invoiceId = '09947127-2702-4f6d-9da8-cb463608d812';

function fakeInvoice(status: string) {
  return {
    status,
    toJSON: () => ({
      id: invoiceId,
      status,
      amount: 100,
      tenantId: 'tenant-1',
      lastErrorCode: null,
    }),
  };
}

describe('nfse_review tool', () => {
  const apply = jest.fn();
  const findByIdAndTenantId = jest.fn();
  const handler = createNfseReviewHandler({ apply }, { findByIdAndTenantId });

  beforeEach(() => {
    jest.resetAllMocks();
    apply.mockResolvedValue([{ id: invoiceId, outcome: 'accepted' }]);
  });

  it('retry: applies the review in the caller tenant and returns the new status', async () => {
    findByIdAndTenantId
      .mockResolvedValueOnce(fakeInvoice('manual_review'))
      .mockResolvedValueOnce(fakeInvoice('reconciliation_required'));
    const result = await handler(
      { invoice_id: invoiceId, action: 'retry' },
      ctx,
    );
    expect(apply).toHaveBeenCalledWith(
      'tenant-1',
      'live',
      'retry',
      [invoiceId],
      'conn-1',
    );
    expect(result).toMatchObject({
      invoice_id: invoiceId,
      action: 'retry',
      outcome: 'accepted',
      status: 'reconciliation_required',
    });
    expect(result.invoice).toMatchObject({ id: invoiceId, amount: 100 });
    expect(result.invoice).not.toHaveProperty('tenantId');
  });

  it('discard: queues the portal check and the invoice stays in review for now', async () => {
    findByIdAndTenantId.mockResolvedValue(fakeInvoice('manual_review'));
    const result = await handler(
      { invoice_id: invoiceId, action: 'discard' },
      ctx,
    );
    expect(apply).toHaveBeenCalledWith(
      'tenant-1',
      'live',
      'discard',
      [invoiceId],
      'conn-1',
    );
    expect(result.status).toBe('manual_review');
  });

  it('fails with the current status when the invoice is not in manual_review', async () => {
    findByIdAndTenantId.mockResolvedValue(fakeInvoice('authorized'));
    await expect(
      handler({ invoice_id: invoiceId, action: 'retry' }, ctx),
    ).rejects.toThrow(/status "authorized".*manual_review/);
    expect(apply).not.toHaveBeenCalled();
  });

  it('fails when the invoice does not exist', async () => {
    findByIdAndTenantId.mockResolvedValue(null);
    await expect(
      handler({ invoice_id: invoiceId, action: 'retry' }, ctx),
    ).rejects.toThrow('Invoice not found');
  });

  it('fails when the service skips the invoice (it changed meanwhile)', async () => {
    findByIdAndTenantId.mockResolvedValue(fakeInvoice('manual_review'));
    apply.mockResolvedValue([
      { id: invoiceId, outcome: 'skipped', reason: 'changed' },
    ]);
    await expect(
      handler({ invoice_id: invoiceId, action: 'retry' }, ctx),
    ).rejects.toThrow(/changed/);
  });

  it('rejects an invalid id or action before touching anything', async () => {
    await expect(
      handler({ invoice_id: 'abc', action: 'retry' }, ctx),
    ).rejects.toThrow(/invoice_id/);
    await expect(
      handler({ invoice_id: invoiceId, action: 'delete' }, ctx),
    ).rejects.toThrow(/action/);
    expect(findByIdAndTenantId).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
