import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import type { NewOutboxMessage } from '../domain/outbox-message';
import { InvoiceMapper } from '../infra/invoice.mapper';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';

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

function build(
  storedStatus: InvoiceStatus,
  reservation: { id: string; amount: number } | null,
) {
  const order: string[] = [];
  const persisted: Record<string, unknown>[] = [];
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
  const invoices = {
    findByIdAndTenantId: jest.fn().mockResolvedValue({ status: storedStatus }),
    // What the repository writes: the mapped row (null last-error columns etc.).
    save: jest.fn(async (invoice: Invoice) => {
      persisted.push(
        new InvoiceMapper().toPersistence(invoice) as unknown as Record<
          string,
          unknown
        >,
      );
    }),
  };
  const events = {
    save: jest.fn(async () => {
      order.push('event');
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
  );
  return {
    service,
    usage,
    outbox,
    order,
    persisted,
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
