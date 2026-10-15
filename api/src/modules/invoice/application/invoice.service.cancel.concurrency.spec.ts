import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { CreditTransactionOrmEntity } from '@/modules/credits/infra/credit-transaction.orm-entity';
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Invoice } from '../domain/invoice';
import {
  ConcurrentInvoiceTransitionError,
  InvoiceNotCancellableError,
} from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import { InvoiceOrmEntity } from '../infra/invoice.orm-entity';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { InvoiceService } from './invoice.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const fiscal = {
  reason: 'issue_error' as const,
  description: 'Valor do serviço informado incorretamente',
};

/**
 * Deterministic in-process simulation of concurrent cancels: the REAL
 * InvoiceService.cancel and InvoiceLifecycleService.transition run against a
 * stateful fake persistence layer. The per-tenant advisory lock is emulated by
 * a promise-chain mutex around DataSource.transaction.
 *
 * `firstReaders` is how many cancel() calls must finish their first read
 * (seeing the pre-cancel status) before any of them may enter a transaction.
 */
function harness(
  initial: InvoiceStatus,
  environment: ExecutionEnvironment,
  firstReaders: number,
) {
  const base = Invoice.create(
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
  ).toSnapshot();

  const row = { status: initial };
  const persisted: Record<string, unknown>[] = [];
  const events: unknown[] = [];
  const walletInserts: Record<string, unknown>[] = [];
  const outboxMessages: { type: string }[] = [];

  const snapshotNow = (): Invoice =>
    Invoice.reconstitute({
      ...base,
      status: row.status,
      authorizedAt: row.status === 'queued' ? null : new Date(),
    });
  const fresh = () => snapshotNow();

  let reads = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => (release = resolve));
  const invoiceRepo = {
    findByIdAndTenantId: jest.fn(async () => {
      const seen = snapshotNow();
      reads += 1;
      if (reads === firstReaders) release();
      if (reads <= firstReaders) await barrier;
      return seen;
    }),
  };

  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: (entity: unknown) => ({
      findOneByOrFail: jest.fn(async () => ({ status: row.status })),
      findOneBy: jest.fn().mockResolvedValue({ id: 'res-1', amount: -1 }),
      createQueryBuilder: () => {
        const qb = {
          update: () => qb,
          set: (values: Record<string, unknown>) => {
            if (entity === InvoiceOrmEntity) {
              persisted.push(values);
              row.status = values.status as InvoiceStatus;
            }
            return qb;
          },
          where: () => qb,
          execute: async () => ({ affected: 1 }),
        };
        return qb;
      },
      insert: jest.fn(async (value: Record<string, unknown>) => {
        if (entity === CreditTransactionOrmEntity) walletInserts.push(value);
        else events.push(value);
      }),
      update: jest.fn(async () => undefined),
    }),
  };

  let tail: Promise<void> = Promise.resolve();
  const database = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) => {
      const previous = tail;
      let done!: () => void;
      tail = new Promise<void>((resolve) => (done = resolve));
      await previous;
      try {
        return await work(manager);
      } finally {
        done();
      }
    }),
  };

  const usage = { reserve: jest.fn(), settle: jest.fn() };
  const outbox = {
    enqueue: jest.fn(async (message: { type: string }) => {
      outboxMessages.push(message);
      return true;
    }),
  };
  const lifecycle = new InvoiceLifecycleService(
    database as never,
    { delete: jest.fn() } as never,
    usage as never,
    new TypeOrmTransactionContext(),
    outbox as never,
  );
  const webhooks = { publish: jest.fn() };
  const service = new InvoiceService(
    invoiceRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    lifecycle,
    {} as never,
    {} as never,
    webhooks as never,
  );

  return {
    id: base.id,
    row,
    service,
    lifecycle,
    webhooks,
    usage,
    persisted,
    events,
    walletInserts,
    outboxMessages,
    fresh,
    cancel: (env: ExecutionEnvironment, input: object) =>
      service.cancel(base.id, tenantId, env, input as never),
  };
}

describe('InvoiceService.cancel — concurrent submissions', () => {
  it('publishes a single cancelled webhook and refunds once for two cancels of a queued invoice', async () => {
    const h = harness('queued', 'live', 2);
    const [a, b] = await Promise.all([
      h.cancel('live', { reason: 'other' }),
      h.cancel('live', { reason: 'other' }),
    ]);
    expect(a.status).toBe('cancelled');
    expect(b.status).toBe('cancelled');
    expect(h.webhooks.publish).toHaveBeenCalledTimes(1);
    expect(h.webhooks.publish).toHaveBeenCalledWith(
      expect.anything(),
      'nfse.invoice.cancelled',
      { reason: 'other' },
    );
    expect(h.events).toHaveLength(1);
    expect(h.persisted).toHaveLength(1);
    expect(h.walletInserts).toEqual([
      expect.objectContaining({ amount: 1, type: 'invoice_rejected' }),
    ]);
    expect(h.usage.settle).toHaveBeenCalledTimes(1);
    expect(h.row.status).toBe('cancelled');
  });

  it('enqueues a single fiscal cancellation for two cancels of an authorized invoice', async () => {
    const h = harness('authorized', 'test', 2);
    const [a, b] = await Promise.all([
      h.cancel('test', fiscal),
      h.cancel('test', fiscal),
    ]);
    expect(a.status).toBe('cancelling');
    expect(b.status).toBe('cancelling');
    expect(h.outboxMessages).toHaveLength(1);
    expect(h.outboxMessages[0].type).toBe('invoice.cancel');
    expect(h.events).toHaveLength(1);
    expect(h.persisted).toHaveLength(1);
    expect(h.webhooks.publish).not.toHaveBeenCalled();
    expect(h.row.status).toBe('cancelling');
  });

  it('refuses the cancel when a worker moves the invoice to processing first', async () => {
    const h = harness('queued', 'live', 1);
    const workerInvoice = h.fresh();
    const workerEvent = workerInvoice.transitionTo('processing');
    // The worker takes the transaction slot first; the cancel read `queued` meanwhile.
    const worker = h.lifecycle.transition(workerInvoice, workerEvent);
    const cancel = h.cancel('live', { reason: 'other' });
    await expect(cancel).rejects.toBeInstanceOf(InvoiceNotCancellableError);
    await expect(worker).resolves.toBe(true);
    expect(h.webhooks.publish).not.toHaveBeenCalled();
    expect(h.walletInserts).toEqual([]);
    expect(h.row.status).toBe('processing');
  });

  it('stops the worker from issuing an invoice that a cancel already committed', async () => {
    const h = harness('queued', 'live', 1);
    const workerInvoice = h.fresh();
    const workerEvent = workerInvoice.transitionTo('processing');
    const cancelled = await h.cancel('live', { reason: 'other' });
    expect(cancelled.status).toBe('cancelled');
    await expect(
      h.lifecycle.transition(workerInvoice, workerEvent),
    ).rejects.toBeInstanceOf(ConcurrentInvoiceTransitionError);
    expect(h.row.status).toBe('cancelled');
    expect(h.persisted).toHaveLength(1);
  });
});
