import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Invoice } from '../domain/invoice';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import { InvoiceMapper } from '../infra/invoice.mapper';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { InvoiceService } from './invoice.service';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';

const tenantId = '11111111-1111-4111-8111-111111111111';
const fiscal = {
  reason: 'issue_error' as const,
  description: 'Valor do serviço informado incorretamente',
};

/**
 * Deterministic in-process simulation of concurrent cancels: the REAL
 * InvoiceService.cancel and InvoiceLifecycleService.transition run against a
 * stateful fake persistence layer. The per-tenant advisory lock is emulated by
 * a promise-chain mutex around UnitOfWorkPort.execute.
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
  const intents: string[] = [];
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
    registerCancellationIntent: jest.fn(async () => {
      if (row.status !== 'processing') return false;
      intents.push('registered');
      return true;
    }),
  };

  // Lifecycle-side persistence ports, sharing the same stateful row.
  const lifecycleInvoices = {
    findByIdAndTenantId: jest.fn(async () => ({ status: row.status })),
    save: jest.fn(async (invoice: Invoice) => {
      persisted.push(
        new InvoiceMapper().toPersistence(invoice) as unknown as Record<
          string,
          unknown
        >,
      );
      row.status = invoice.status;
    }),
  };
  const eventRepo = {
    save: jest.fn(async (event: unknown) => {
      events.push(event);
    }),
  };
  const credits = {
    findByReservedInvoiceId: jest
      .fn()
      .mockResolvedValue({ id: 'res-1', amount: -1 }),
    save: jest.fn(async (value: Record<string, unknown>) => {
      walletInserts.push(value);
    }),
    confirm: jest.fn(async () => undefined),
  };

  // The per-tenant advisory lock + transaction, emulated by a promise-chain mutex.
  let tail: Promise<void> = Promise.resolve();
  const unitOfWork = {
    execute: jest.fn(async <T>(work: () => Promise<T>): Promise<T> => {
      const previous = tail;
      let done!: () => void;
      tail = new Promise<void>((resolve) => (done = resolve));
      await previous;
      try {
        return await work();
      } finally {
        done();
      }
    }),
  };
  const billing = {
    locked: jest.fn(async <T>(_tenantId: string, work: () => Promise<T>) =>
      work(),
    ),
  };

  const usage = { reserve: jest.fn(), settle: jest.fn() };
  const outbox = {
    enqueue: jest.fn(async (message: { type: string }) => {
      outboxMessages.push(message);
      return true;
    }),
  };
  const lifecycle = new InvoiceLifecycleService(
    unitOfWork as never,
    { delete: jest.fn() } as never,
    usage as never,
    billing as never,
    outbox as never,
    lifecycleInvoices as never,
    eventRepo as never,
    credits as never,
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
    { isSimulated: (environment: string) => environment !== 'live' } as never,
    new FakeAccountAudit(),
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
    intents,
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

  it('registers a pending cancellation when a worker moves the invoice to processing first', async () => {
    const h = harness('queued', 'live', 1);
    const workerInvoice = h.fresh();
    const workerEvent = workerInvoice.transitionTo('processing');
    // The worker takes the transaction slot first; the cancel read `queued` meanwhile.
    const worker = h.lifecycle.transition(workerInvoice, workerEvent);
    const cancelled = await h.cancel('live', { reason: 'other' });
    expect(cancelled.hasPendingCancellation).toBe(true);
    expect(h.intents).toEqual(['registered']);
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
