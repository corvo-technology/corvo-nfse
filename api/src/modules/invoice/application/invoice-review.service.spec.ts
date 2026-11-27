import { Invoice } from '../domain/invoice';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import { InvoiceReviewService } from './invoice-review.service';
import { DPS_USED_BY_OTHER_NFSE } from '../domain/fiscal/portal-nfse-match';

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
  const audit = { record: jest.fn() };
  const service = new InvoiceReviewService(
    invoices as never,
    lifecycle as never,
    queues as never,
    audit,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    lifecycle.transition.mockResolvedValue(true);
    audit.record.mockResolvedValue(undefined);
  });

  it('records an audit event for retry and for discard, and none for skipped invoices', async () => {
    const retried = invoiceIn('manual_review');
    const discarded = invoiceIn('manual_review');
    const authorized = invoiceIn('authorized');
    invoices.findByIdAndTenantId.mockImplementation((id: string) =>
      Promise.resolve(
        [retried, discarded, authorized].find((i) => i.id === id) ?? null,
      ),
    );

    await service.apply(tenantId, 'live', 'retry', [retried.id], 'user-1');
    await service.apply(tenantId, 'live', 'discard', [discarded.id], 'user-1');
    await service.apply(tenantId, 'live', 'retry', [authorized.id], 'user-1');

    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        environment: 'live',
        action: 'invoice.review_retried',
        target: expect.objectContaining({ type: 'invoice', id: retried.id }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoice.review_discarded',
        target: expect.objectContaining({ id: discarded.id }),
      }),
    );
  });

  it('keeps going when the audit fails', async () => {
    const invoice = invoiceIn('manual_review');
    invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    audit.record.mockRejectedValue(new Error('db down'));
    await expect(
      service.apply(tenantId, 'live', 'retry', [invoice.id], 'user-1'),
    ).resolves.toEqual([{ id: invoice.id, outcome: 'accepted' }]);
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

  it.each([
    ['live', 'nfse-reconciliation'],
    ['test', 'nfse-reconciliation-test'],
  ] as const)(
    'a %s retry or discard is queued on %s',
    async (environment, queue) => {
      const invoice = invoiceIn('manual_review');
      invoices.findByIdAndTenantId.mockResolvedValue(invoice);
      await service.apply(
        tenantId,
        environment,
        'discard',
        [invoice.id],
        'user-1',
      );
      await service.apply(
        tenantId,
        environment,
        'retry',
        [invoice.id],
        'user-1',
      );
      const used = (queues.add.mock.calls as unknown[][]).map((c) => c[0]);
      expect(used).toEqual([queue, queue]);
    },
  );

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

  it('retries an invoice whose DPS the portal has on another note by emitting with a new number, and still discards it', async () => {
    const invoice = invoiceIn('manual_review');
    invoice.setRejected(DPS_USED_BY_OTHER_NFSE, 'já foi usado por outra nota');
    invoices.findByIdAndTenantId.mockResolvedValue(invoice);

    const retried = await service.apply(
      tenantId,
      'live',
      'retry',
      [invoice.id],
      'user-1',
    );

    expect(retried).toEqual([{ id: invoice.id, outcome: 'accepted' }]);
    expect(queues.add).toHaveBeenCalledWith(
      'nfse-reconciliation',
      'reconcile',
      expect.objectContaining({ invoiceId: invoice.id, review: 'renumber' }),
      expect.objectContaining({
        idempotencyKey: `review-renumber:${invoice.id}`,
      }),
    );
    expect(invoice.status).toBe('manual_review');
    queues.add.mockClear();

    const discarded = await service.apply(
      tenantId,
      'live',
      'discard',
      [invoice.id],
      'user-1',
    );

    expect(discarded).toEqual([{ id: invoice.id, outcome: 'accepted' }]);
    expect(queues.add).toHaveBeenCalledWith(
      'nfse-reconciliation',
      'reconcile',
      expect.objectContaining({ invoiceId: invoice.id, review: 'discard' }),
      expect.anything(),
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
