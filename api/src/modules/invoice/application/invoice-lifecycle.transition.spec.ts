import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import type { NewOutboxMessage } from '../domain/outbox-message';
import { CreditTransactionOrmEntity } from '@/modules/credits/infra/credit-transaction.orm-entity';
import { InvoiceOrmEntity } from '../infra/invoice.orm-entity';
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
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: (entity: unknown) => ({
      findOneByOrFail: jest.fn().mockResolvedValue({ status: storedStatus }),
      findOneBy: jest.fn().mockResolvedValue(reservation),
      createQueryBuilder: () => {
        const qb = {
          update: () => qb,
          set: (values: Record<string, unknown>) => {
            if (entity === InvoiceOrmEntity) persisted.push(values);
            return qb;
          },
          where: () => qb,
          execute: async () => ({ affected: 1 }),
        };
        return qb;
      },
      insert: jest.fn(async (value: Record<string, unknown>) => {
        if (entity === CreditTransactionOrmEntity) walletInserts.push(value);
        else order.push('event');
      }),
      update: jest.fn(async (...args: unknown[]) => {
        walletUpdates.push(args);
      }),
    }),
  };
  const database = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<void>) =>
      work(manager),
    ),
  };
  const usage = { reserve: jest.fn(), settle: jest.fn() };
  const outbox = {
    enqueue: jest.fn(async () => {
      order.push('outbox');
      return true;
    }),
  };
  const service = new InvoiceLifecycleService(
    database as never,
    { delete: jest.fn() } as never,
    usage as never,
    new TypeOrmTransactionContext(),
    outbox as never,
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
    expect(ctx.walletUpdates[0][1]).toEqual({ isReservation: false });
    expect(ctx.persisted[0]).toMatchObject({ pendingEmission: null });
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

  it('keeps the pending fiscal event while cancelling', async () => {
    const ctx = build('authorized', null);
    const invoice = invoiceIn('authorized', 'test');
    await ctx.service.transition(
      invoice,
      invoice.requestCancellation(
        cancellationReason('issue_error', 'Valor informado incorretamente'),
      ),
    );
    // The mapped entity may carry the key as undefined, which TypeORM skips on update.
    expect(ctx.persisted[0].pendingEmission).toBeUndefined();
  });

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
