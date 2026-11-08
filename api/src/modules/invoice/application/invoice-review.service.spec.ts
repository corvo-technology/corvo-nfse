import { Invoice } from '../domain/invoice';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import { InvoiceReviewService } from './invoice-review.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function invoiceIn(status: 'manual_review' | 'authorized'): Invoice {
  const invoice = Invoice.create(
    {
      companyId: 'company-1',
      customer: null,
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-11-01'),
    },
    tenantId,
  );
  invoice.setProcessing();
  if (status === 'authorized') {
    invoice.transitionTo('authorized');
    return invoice;
  }
  invoice.transitionTo('reconciliation_required');
  invoice.transitionTo('manual_review');
  return invoice;
}

describe('InvoiceReviewService', () => {
  const invoices = { findByIdAndTenantId: jest.fn() };
  const lifecycle = { transition: jest.fn() };
  const queues = { add: jest.fn() };
  const service = new InvoiceReviewService(
    invoices as never,
    lifecycle as never,
    queues as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    lifecycle.transition.mockResolvedValue(true);
  });

  it('retry moves the invoice back to reconciliation and queues one job with the same invoice', async () => {
    const invoice = invoiceIn('manual_review');
    invoices.findByIdAndTenantId.mockResolvedValue(invoice);

    const result = await service.apply(
      tenantId,
      'live',
      'retry',
      [invoice.id],
      'user-1',
    );

    expect(result).toEqual([{ id: invoice.id, outcome: 'accepted' }]);
    expect(invoice.status).toBe('reconciliation_required');
    expect(invoices.findByIdAndTenantId).toHaveBeenCalledWith(
      invoice.id,
      tenantId,
      'live',
    );
    expect(queues.add).toHaveBeenCalledTimes(1);
    expect(queues.add).toHaveBeenCalledWith(
      'nfse-reconciliation',
      'reconcile',
      expect.objectContaining({
        invoiceId: invoice.id,
        attemptCount: 0,
        uncertainSince: expect.any(String),
      }),
      expect.anything(),
    );
  });

  it('discard does not change the invoice: a worker asks the portal first', async () => {
    const invoice = invoiceIn('manual_review');
    invoices.findByIdAndTenantId.mockResolvedValue(invoice);

    await service.apply(tenantId, 'live', 'discard', [invoice.id], 'user-1');

    expect(invoice.status).toBe('manual_review');
    expect(lifecycle.transition).not.toHaveBeenCalled();
    expect(queues.add).toHaveBeenCalledWith(
      'nfse-reconciliation',
      'reconcile',
      expect.objectContaining({ invoiceId: invoice.id, review: 'discard' }),
      expect.objectContaining({
        idempotencyKey: `review-discard:${invoice.id}`,
      }),
    );
  });

  it('skips invoices that are missing, not in review or changed meanwhile, and repeats nothing', async () => {
    const authorized = invoiceIn('authorized');
    const raced = invoiceIn('manual_review');
    invoices.findByIdAndTenantId.mockImplementation((id: string) =>
      Promise.resolve(
        id === authorized.id ? authorized : id === raced.id ? raced : null,
      ),
    );
    lifecycle.transition.mockRejectedValue(
      new ConcurrentInvoiceTransitionError(raced.id),
    );

    const result = await service.apply(
      tenantId,
      'live',
      'retry',
      ['missing', authorized.id, raced.id, raced.id],
      'user-1',
    );

    expect(result).toEqual([
      { id: 'missing', outcome: 'skipped', reason: 'not_found' },
      { id: authorized.id, outcome: 'skipped', reason: 'not_in_manual_review' },
      { id: raced.id, outcome: 'skipped', reason: 'changed' },
    ]);
    expect(queues.add).not.toHaveBeenCalled();
  });
});
