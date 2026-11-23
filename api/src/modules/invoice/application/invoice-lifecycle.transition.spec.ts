import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import type { NewOutboxMessage } from '../domain/outbox-message';
import type { InvoiceEvent } from '../domain/invoice-event';
import { TypeOrmInvoiceRepository } from '../infra/typeorm-invoice.repository';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { cancellationMessage } from './invoice-cancel.handler';

const tenantId = '11111111-1111-4111-8111-111111111111';

function invoiceIn(status: InvoiceStatus, environment: 'test' | 'live') {
  const created = Invoice.create(
    {
      companyId: '22222222-2222-4222-8222-222222222222',
      environment,
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    tenantId,
  );
  return Invoice.reconstitute({
    ...created.toSnapshot(),
    status,
    authorizedAt: status === 'authorized' ? new Date() : null,
  });
}

/** The real repository over a query builder that records each UPDATE set. */
function capturingRepository(persisted: Record<string, unknown>[]) {
  const qb: Record<string, jest.Mock> = {};
  qb.update = jest.fn(() => qb);
  qb.set = jest.fn((values: Record<string, unknown>) => {
    // TypeORM skips undefined values: only what is really written is kept.
    persisted.push(
      Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
      ),
    );
    return qb;
  });
  qb.where = jest.fn(() => qb);
  qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
  return new TypeOrmInvoiceRepository({
    repository: () => ({ createQueryBuilder: () => qb }),
  } as never);
}

function build(
  stored: InvoiceStatus | Invoice,
  reservation: { id: string; amount: number } | null,
  pdfRefresher?: { request: jest.Mock },
) {
  const order: string[] = [];
  const persisted: Record<string, unknown>[] = [];
  const savedEvents: InvoiceEvent[] = [];
  const walletInserts: Record<string, unknown>[] = [];
  const walletUpdates: unknown[][] = [];
  const unitOfWork = {
    execute: jest.fn(async <T>(work: () => Promise<T>) => work()),
  };
  const billing = {
    locked: jest.fn(async <T>(_tenantId: string, work: () => Promise<T>) =>
      work(),
    ),
  };
  const repository = capturingRepository(persisted);
  const invoices = {
    findByIdAndTenantId: jest
      .fn()
      .mockResolvedValue(
        typeof stored === 'string' ? { status: stored } : stored,
      ),
    // What the repository really writes (the UPDATE set).
    save: jest.fn(repository.save.bind(repository)),
  };
  const events = {
    save: jest.fn(async (event: InvoiceEvent) => {
      order.push('event');
      savedEvents.push(event);
    }),
  };
  const credits = {
    findByReservedInvoiceId: jest.fn().mockResolvedValue(reservation),
    save: jest.fn(async (value: Record<string, unknown>) => {
      walletInserts.push(value);
    }),
    confirm: jest.fn(async (...args: unknown[]) => {
      walletUpdates.push(args);
    }),
  };
  const usage = { reserve: jest.fn(), settle: jest.fn() };
  const outbox = {
    enqueue: jest.fn(async () => {
      order.push('outbox');
      return true;
    }),
  };
  const service = new InvoiceLifecycleService(
    unitOfWork as never,
    { delete: jest.fn() } as never,
    usage as never,
    billing as never,
    outbox as never,
    invoices as never,
    events as never,
    credits as never,
    undefined,
    undefined,
    pdfRefresher as never,
  );
  return {
    service,
    invoices,
    usage,
    outbox,
    order,
    persisted,
    savedEvents,
    walletInserts,
    walletUpdates,
  };
}

const message: NewOutboxMessage = {
  tenantId,
  environment: 'live',
  type: 'invoice.cancel',
  aggregateId: 'inv',
  payload: {},
  dedupeKey: 'cancellation:evt',
};

describe('InvoiceLifecycleService.transition — cancellation', () => {
  it('refunds the live reservation and settles usage when a queued invoice is cancelled', async () => {
    const ctx = build('queued', { id: 'res-1', amount: -1 });
    const invoice = invoiceIn('queued', 'live');
    await ctx.service.transition(
      invoice,
      invoice.requestCancellation(cancellationReason('other')),
    );
    expect(ctx.usage.settle).toHaveBeenCalledWith(
      invoice.id,
      tenantId,
      'cancelled',
    );
    expect(ctx.walletInserts).toEqual([
      expect.objectContaining({ amount: 1, type: 'invoice_rejected' }),
    ]);
    // The reservation is released (credits.confirm marks it non-reservation);
    // clearing pending_emission for `cancelled` is the repository's job.
    expect(ctx.walletUpdates).toEqual([['res-1', tenantId]]);
    expect(ctx.persisted[0]).toMatchObject({ status: 'cancelled' });
  });

  it('enqueues the outbox message after the event, in the same transaction', async () => {
    const ctx = build('authorized', null);
    const invoice = invoiceIn('authorized', 'live');
    const event = invoice.requestCancellation(
      cancellationReason('issue_error', 'Valor informado incorretamente'),
    );
    await ctx.service.transition(invoice, event, message);
    expect(ctx.order).toEqual(['event', 'outbox']);
    expect(ctx.outbox.enqueue).toHaveBeenCalledWith(message);
    expect(ctx.walletInserts).toEqual([]);
  });

  describe('transitions from a fiscally authorized invoice never touch credit', () => {
    const reservation = { id: 'res-1', amount: -1 };
    const fiscalReason = cancellationReason(
      'issue_error',
      'Valor informado incorretamente',
    );

    function expectNoCreditEffects(ctx: ReturnType<typeof build>) {
      expect(ctx.walletInserts).toEqual([]);
      expect(ctx.walletUpdates).toEqual([]);
      expect(ctx.usage.settle).not.toHaveBeenCalled();
    }

    it('authorized → cancelling', async () => {
      const ctx = build('authorized', reservation);
      const invoice = invoiceIn('authorized', 'live');
      await expect(
        ctx.service.transition(
          invoice,
          invoice.requestCancellation(fiscalReason),
          message,
        ),
      ).resolves.toBe(true);
      expectNoCreditEffects(ctx);
    });

    it('cancelling → cancelled', async () => {
      const ctx = build('cancelling', reservation);
      const invoice = invoiceIn('authorized', 'live');
      invoice.requestCancellation(fiscalReason);
      await expect(
        ctx.service.transition(invoice, invoice.confirmCancellation()),
      ).resolves.toBe(true);
      expectNoCreditEffects(ctx);
    });

    it('cancelling → authorized (rejected cancellation)', async () => {
      const ctx = build('cancelling', reservation);
      const invoice = invoiceIn('authorized', 'live');
      invoice.requestCancellation(fiscalReason);
      await expect(
        ctx.service.transition(
          invoice,
          invoice.rejectCancellation('E0840', 'Prazo expirado'),
        ),
      ).resolves.toBe(true);
      expectNoCreditEffects(ctx);
    });
  });

  it.each(['request', 'confirm'] as const)(
    'writes null last-error columns on %s cancellation so a stale error is erased',
    async (step) => {
      const ctx = build(step === 'request' ? 'authorized' : 'cancelling', null);
      const invoice = invoiceIn('authorized', 'test');
      const reason = cancellationReason(
        'issue_error',
        'Valor informado incorretamente',
      );
      invoice.requestCancellation(reason);
      invoice.rejectCancellation('E0840', 'Prazo expirado');
      const event =
        step === 'request'
          ? invoice.requestCancellation(reason)
          : (invoice.requestCancellation(reason),
            invoice.confirmCancellation());
      await ctx.service.transition(invoice, event);
      expect(ctx.persisted[0]).toMatchObject({
        lastErrorCode: null,
        lastErrorMessage: null,
        lastErrorProvider: null,
      });
    },
  );

  it('reports true when it applies the transition', async () => {
    const ctx = build('queued', null);
    const invoice = invoiceIn('queued', 'test');
    await expect(
      ctx.service.transition(
        invoice,
        invoice.requestCancellation(cancellationReason('other')),
      ),
    ).resolves.toBe(true);
  });

  it('reports false and writes nothing when the stored status already is the target', async () => {
    const ctx = build('cancelled', null);
    const invoice = invoiceIn('queued', 'live');
    await expect(
      ctx.service.transition(
        invoice,
        invoice.requestCancellation(cancellationReason('other')),
        message,
      ),
    ).resolves.toBe(false);
    expect(ctx.persisted).toEqual([]);
    expect(ctx.outbox.enqueue).not.toHaveBeenCalled();
    expect(ctx.usage.settle).not.toHaveBeenCalled();
  });

  it('throws a typed error when another writer changed the status', async () => {
    const ctx = build('processing', null);
    const invoice = invoiceIn('queued', 'test');
    await expect(
      ctx.service.transition(
        invoice,
        invoice.requestCancellation(cancellationReason('other')),
      ),
    ).rejects.toBeInstanceOf(ConcurrentInvoiceTransitionError);
    expect(ctx.outbox.enqueue).not.toHaveBeenCalled();
  });
});

describe('InvoiceLifecycleService.transition — cancellation requested during emission', () => {
  const cancellationColumns = [
    'cancellationReason',
    'cancellationDescription',
    'cancellationRequestedAt',
  ];
  const requestedAt = new Date('2026-10-14T12:00:00Z');
  const pendingReason = cancellationReason(
    'issue_error',
    'Valor informado incorretamente',
  );

  /** The row as the database holds it: same status, plus the API's intent. */
  function storedWithIntent(invoice: Invoice): Invoice {
    return Invoice.reconstitute({
      ...invoice.toSnapshot(),
      cancellationReason: pendingReason.code,
      cancellationDescription: pendingReason.description,
      cancellationRequestedAt: requestedAt,
    });
  }

  function storedWithoutIntent(invoice: Invoice): Invoice {
    return Invoice.reconstitute(invoice.toSnapshot());
  }

  describe('the worker copy never writes the cancellation columns', () => {
    it.each([
      ['processing', 'retry_pending', true],
      ['processing', 'reconciliation_required', true],
      ['retry_pending', 'processing', true],
      ['reconciliation_required', 'manual_review', true],
      ['processing', 'authorized', false],
      ['reconciliation_required', 'authorized', false],
    ] as const)('%s → %s', async (from, to, intentStored) => {
      // The worker loaded the invoice before the intent was registered.
      const invoice = invoiceIn(from, 'live');
      const stored = intentStored
        ? storedWithIntent(invoice)
        : storedWithoutIntent(invoice);
      const ctx = build(stored, { id: 'res-1', amount: -1 });

      await expect(
        ctx.service.transition(invoice, invoice.transitionTo(to)),
      ).resolves.toBe(true);

      expect(ctx.persisted).toHaveLength(1);
      expect(ctx.persisted[0]).toMatchObject({ status: to });
      for (const column of cancellationColumns)
        expect(ctx.persisted[0]).not.toHaveProperty(column);
    });
  });

  it('reads the stored row with a write lock, so an intent cannot slip in before the authorization is written', async () => {
    const invoice = invoiceIn('processing', 'live');
    const ctx = build(storedWithoutIntent(invoice), null);
    invoice.setAuthorized('a'.repeat(50), 42);

    await ctx.service.transition(
      invoice,
      invoice.transitionTo('authorized', 'NFS-e authorized'),
    );

    expect(ctx.invoices.findByIdAndTenantId).toHaveBeenCalledTimes(1);
    expect(ctx.invoices.findByIdAndTenantId).toHaveBeenCalledWith(
      invoice.id,
      tenantId,
      'live',
      { forUpdate: true },
    );
  });

  describe('an emission that does not authorize discards the request', () => {
    it.each([
      ['processing', 'rejected'],
      ['processing', 'failed'],
      ['reconciliation_required', 'rejected'],
    ] as const)(
      '%s → %s clears the columns and records the discard',
      async (from, to) => {
        // This worker copy was loaded after the intent was registered.
        const invoice = storedWithIntent(invoiceIn(from, 'live'));
        const ctx = build(storedWithIntent(invoice), {
          id: 'res-1',
          amount: -1,
        });
        const event = invoice.transitionTo(to, 'Rejected by Sefin');

        await expect(ctx.service.transition(invoice, event)).resolves.toBe(
          true,
        );

        expect(ctx.persisted).toHaveLength(1);
        expect(ctx.persisted[0]).toMatchObject({
          status: to,
          cancellationReason: null,
          cancellationDescription: null,
          cancellationRequestedAt: null,
        });
        expect(ctx.savedEvents).toHaveLength(1);
        expect(ctx.savedEvents[0].toSnapshot()).toMatchObject({
          id: event.id,
          fromStatus: from,
          toStatus: to,
          reason: 'Rejected by Sefin (pending cancellation request discarded)',
        });
        expect(invoice.cancellationRequestedAt).toBeNull();
        // The reservation is refunded as for any rejected emission.
        expect(ctx.walletInserts).toEqual([
          expect.objectContaining({ amount: 1, type: 'invoice_rejected' }),
        ]);
      },
    );

    it('keeps the event reason when there was no request to discard', async () => {
      const invoice = invoiceIn('processing', 'test');
      const ctx = build(storedWithoutIntent(invoice), null);
      const event = invoice.transitionTo('rejected', 'Rejected by Sefin');

      await ctx.service.transition(invoice, event);

      expect(ctx.persisted[0]).toMatchObject({ cancellationRequestedAt: null });
      expect(ctx.savedEvents.map((e) => e.toSnapshot().reason)).toEqual([
        'Rejected by Sefin',
      ]);
    });
  });

  describe('authorization applies the stored request atomically', () => {
    it.each(['processing', 'reconciliation_required'] as const)(
      '%s → authorized → cancelling in the same transition',
      async (from) => {
        const invoice = invoiceIn(from, 'live');
        const ctx = build(storedWithIntent(invoice), {
          id: 'res-1',
          amount: -1,
        });
        invoice.setRejected('E999', 'stale error');
        invoice.setAuthorized('a'.repeat(50), 42);
        const authorization = invoice.transitionTo(
          'authorized',
          'NFS-e authorized',
        );

        await expect(
          ctx.service.transition(invoice, authorization),
        ).resolves.toBe(true);

        expect(invoice.status).toBe('cancelling');
        expect(invoice.cancellationReason).toEqual(pendingReason);
        expect(ctx.savedEvents).toHaveLength(2);
        const [first, second] = ctx.savedEvents.map((e) => e.toSnapshot());
        expect(first).toMatchObject({
          id: authorization.id,
          fromStatus: from,
          toStatus: 'authorized',
        });
        expect(second).toMatchObject({
          fromStatus: 'authorized',
          toStatus: 'cancelling',
        });
        expect(ctx.order).toEqual(['event', 'event', 'outbox']);
        expect(ctx.outbox.enqueue).toHaveBeenCalledTimes(1);
        expect(ctx.outbox.enqueue).toHaveBeenCalledWith(
          cancellationMessage(invoice, ctx.savedEvents[1]),
        );
        expect(ctx.outbox.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ dedupeKey: `cancellation:${second.id}` }),
        );
        // Authorized first (frees the emission's pending XML), then cancelling;
        // neither write touches the stored request (its original timestamp stays).
        expect(ctx.persisted.map((row) => row.status)).toEqual([
          'authorized',
          'cancelling',
        ]);
        expect(ctx.persisted[0]).toMatchObject({ pendingEmission: null });
        expect(ctx.persisted[1]).toMatchObject({
          lastErrorCode: null,
          lastErrorMessage: null,
        });
        for (const row of ctx.persisted)
          for (const column of cancellationColumns)
            expect(row).not.toHaveProperty(column);
        // Credit: the first movement consumes the reservation, the second does nothing.
        expect(ctx.usage.settle).toHaveBeenCalledTimes(1);
        expect(ctx.usage.settle).toHaveBeenCalledWith(
          invoice.id,
          tenantId,
          'authorized',
        );
        expect(ctx.walletUpdates).toEqual([['res-1', tenantId]]);
        expect(ctx.walletInserts).toEqual([]);
      },
    );

    it('applies the request in the test environment too', async () => {
      const invoice = invoiceIn('processing', 'test');
      const ctx = build(storedWithIntent(invoice), null);
      invoice.setAuthorized('a'.repeat(50), 42);

      await ctx.service.transition(
        invoice,
        invoice.transitionTo('authorized', 'NFS-e authorized'),
      );

      expect(invoice.status).toBe('cancelling');
      expect(ctx.outbox.enqueue).toHaveBeenCalledTimes(1);
    });

    it('without a stored request, authorization behaves as before', async () => {
      const invoice = invoiceIn('processing', 'live');
      const ctx = build(storedWithoutIntent(invoice), {
        id: 'res-1',
        amount: -1,
      });
      invoice.setAuthorized('a'.repeat(50), 42);

      await expect(
        ctx.service.transition(
          invoice,
          invoice.transitionTo('authorized', 'NFS-e authorized'),
        ),
      ).resolves.toBe(true);

      expect(invoice.status).toBe('authorized');
      expect(ctx.savedEvents).toHaveLength(1);
      expect(ctx.outbox.enqueue).not.toHaveBeenCalled();
      expect(ctx.persisted.map((row) => row.status)).toEqual(['authorized']);
      expect(ctx.usage.settle).toHaveBeenCalledWith(
        invoice.id,
        tenantId,
        'authorized',
      );
      expect(ctx.walletUpdates).toEqual([['res-1', tenantId]]);
    });
  });

  describe('cancellation flow transitions keep writing the columns', () => {
    it('queued → cancelled', async () => {
      const ctx = build('queued', null);
      const invoice = invoiceIn('queued', 'test');
      await ctx.service.transition(
        invoice,
        invoice.requestCancellation(cancellationReason('other')),
      );
      expect(ctx.persisted[0]).toMatchObject({
        cancellationReason: 'other',
        cancellationDescription: null,
        cancellationRequestedAt: expect.any(Date),
      });
    });

    it('authorized → cancelling', async () => {
      const ctx = build('authorized', null);
      const invoice = invoiceIn('authorized', 'test');
      const event = invoice.requestCancellation(pendingReason);
      await ctx.service.transition(invoice, event, message);
      expect(ctx.persisted[0]).toMatchObject({
        cancellationReason: 'issue_error',
        cancellationDescription: 'Valor informado incorretamente',
        cancellationRequestedAt: event.createdAt,
      });
    });

    it.each(['confirm', 'reject'] as const)(
      'cancelling → %s',
      async (outcome) => {
        const ctx = build('cancelling', null);
        const invoice = invoiceIn('authorized', 'test');
        invoice.requestCancellation(pendingReason);
        const event =
          outcome === 'confirm'
            ? invoice.confirmCancellation()
            : invoice.rejectCancellation('E0840', 'Prazo expirado');
        await ctx.service.transition(invoice, event);
        expect(ctx.persisted[0]).toMatchObject({
          cancellationReason: 'issue_error',
          cancellationDescription: 'Valor informado incorretamente',
          cancellationRequestedAt: expect.any(Date),
        });
      },
    );
  });
});

describe('InvoiceLifecycleService.transition — PDF of a cancelled invoice', () => {
  const reason = cancellationReason(
    'issue_error',
    'Valor informado incorretamente',
  );
  const okRefresher = () => ({
    request: jest.fn().mockResolvedValue(undefined),
  });

  it('asks for the PDF to be redone when a cancellation is confirmed', async () => {
    const refresher = okRefresher();
    const ctx = build('cancelling', null, refresher);
    const invoice = invoiceIn('authorized', 'live');
    invoice.requestCancellation(reason);
    await ctx.service.transition(invoice, invoice.confirmCancellation());
    expect(refresher.request).toHaveBeenCalledWith(invoice);
  });

  it('asks for it when the substitute authorization cancels the original', async () => {
    const refresher = okRefresher();
    const ctx = build('authorized', null, refresher);
    const invoice = invoiceIn('authorized', 'live');
    await ctx.service.transition(invoice, invoice.markSubstituted('sub-1'));
    expect(refresher.request).toHaveBeenCalledWith(invoice);
  });

  it('asks for it when the portal reports the cancellation', async () => {
    const refresher = okRefresher();
    const ctx = build('authorized', null, refresher);
    const invoice = invoiceIn('authorized', 'live');
    await ctx.service.transition(invoice, invoice.markCancelledOnPortal(null));
    expect(refresher.request).toHaveBeenCalledWith(invoice);
  });

  it('does not ask when the transition was already applied (retry)', async () => {
    const refresher = okRefresher();
    const ctx = build('cancelled', null, refresher);
    const invoice = invoiceIn('authorized', 'live');
    invoice.requestCancellation(reason);
    await ctx.service.transition(invoice, invoice.confirmCancellation());
    expect(refresher.request).not.toHaveBeenCalled();
  });

  it('does not ask for other transitions', async () => {
    const refresher = okRefresher();
    const ctx = build('authorized', null, refresher);
    const invoice = invoiceIn('authorized', 'live');
    await ctx.service.transition(invoice, invoice.requestCancellation(reason));
    expect(refresher.request).not.toHaveBeenCalled();
  });

  it('never fails the cancellation when the request fails', async () => {
    const refresher = {
      request: jest.fn().mockRejectedValue(new Error('redis')),
    };
    const ctx = build('cancelling', null, refresher);
    const invoice = invoiceIn('authorized', 'live');
    invoice.requestCancellation(reason);
    await expect(
      ctx.service.transition(invoice, invoice.confirmCancellation()),
    ).resolves.toBe(true);
  });
});
