import { Invoice } from '../domain/invoice';
import { InvoiceEvent } from '../domain/invoice-event';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { CreditTransaction } from '@/modules/credits/domain/credit-transaction';
import { BillingRuleError } from '@/modules/billing/domain/billing-period';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';

const newInvoice = (
  scheduledFor?: Date,
  environment: 'test' | 'live' = 'test',
  idempotencyKey?: string,
) =>
  Invoice.create(
    {
      companyId,
      environment,
      customer: { taxId: '52998224725', name: 'Cliente' },
      service: {
        description: 'Servico',
        code: '060101',
        municipalityCode: '3550308',
      },
      amount: 50,
      competenceDate: new Date('2026-10-13'),
      scheduledFor,
    },
    tenantId,
    idempotencyKey,
  );

function build() {
  let active = false;
  const order: string[] = [];
  const inTransaction = (step: string) => {
    expect(active).toBe(true);
    order.push(step);
  };
  const unitOfWork = {
    execute: jest.fn(async <T>(work: () => Promise<T>): Promise<T> => {
      active = true;
      try {
        const result = await work();
        order.push('commit');
        return result;
      } finally {
        active = false;
      }
    }),
  };
  const billing = {
    locked: jest.fn(
      async <T>(_tenantId: string, work: () => Promise<T>): Promise<T> => {
        inTransaction('lock');
        return work();
      },
    ),
  };
  const invoices = {
    findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    findByIdAndTenantId: jest.fn(),
    insert: jest.fn(async () => {
      inTransaction('invoice');
    }),
    save: jest.fn(async () => {
      inTransaction('transition');
    }),
  };
  const events = {
    save: jest.fn(async () => {
      inTransaction('event');
    }),
  };
  const credits = {
    save: jest.fn(async () => {
      inTransaction('credit');
    }),
    findByReservedInvoiceId: jest.fn().mockResolvedValue(null),
    confirm: jest.fn(async () => {
      inTransaction('confirm');
    }),
  };
  const usage = {
    reserve: jest.fn(async () => {
      inTransaction('reserve');
      return 'period-1';
    }),
    settle: jest.fn(async () => {
      inTransaction('settle');
    }),
  };
  const outbox = {
    enqueue: jest.fn(async () => {
      inTransaction('outbox');
      return true;
    }),
  };
  const cache = {
    delete: jest.fn(async () => {
      expect(active).toBe(false);
      order.push('cache');
    }),
  };
  const eventBus = { publishBestEffort: jest.fn() };
  const service = new InvoiceLifecycleService(
    unitOfWork as never,
    cache as never,
    usage as never,
    billing as never,
    outbox as never,
    invoices as never,
    events as never,
    credits as never,
    eventBus as never,
  );
  return {
    service,
    eventBus,
    unitOfWork,
    billing,
    invoices,
    events,
    credits,
    usage,
    outbox,
    cache,
    order,
  };
}

describe('InvoiceLifecycleService', () => {
  it('persists invoice/event/calculation message within the locked unit of work', async () => {
    const f = build();
    const invoice = newInvoice();
    await f.service.submit(
      invoice,
      InvoiceEvent.create(invoice.id, null, 'queued'),
      null,
    );
    expect(f.order).toEqual(['lock', 'invoice', 'event', 'outbox', 'commit']);
    expect(f.billing.locked).toHaveBeenCalledWith(
      tenantId,
      expect.any(Function),
    );
    expect(f.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'invoice.calculate-taxes',
        aggregateId: invoice.id,
        dedupeKey: `calc:${invoice.id}`,
        payload: { invoiceId: invoice.id, companyId, tenantId },
        environment: 'test',
      }),
    );
    expect(f.credits.save).not.toHaveBeenCalled();
  });

  it('preserves the exact scheduled availability and immediate default', async () => {
    const f = build();
    const when = new Date('2099-10-14T12:00:00.000Z');
    for (const scheduledFor of [when, undefined]) {
      const invoice = newInvoice(scheduledFor);
      await f.service.submit(
        invoice,
        InvoiceEvent.create(invoice.id, null, 'queued'),
        null,
      );
      expect(f.outbox.enqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ availableAt: scheduledFor }),
      );
    }
  });

  it('publishes the credits usage event after a live reservation only', async () => {
    const live = build();
    live.invoices.findByIdAndTenantId.mockResolvedValue({
      status: 'processing',
    });
    const liveInvoice = newInvoice(undefined, 'live');
    await live.service.submit(
      liveInvoice,
      InvoiceEvent.create(liveInvoice.id, null, 'queued'),
      null,
    );
    expect(live.eventBus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'billing.credits.usage_changed',
        tenantId: liveInvoice.tenantId,
      }),
    );

    const test = build();
    test.invoices.findByIdAndTenantId.mockResolvedValue({
      status: 'processing',
    });
    const testInvoice = newInvoice();
    await test.service.submit(
      testInvoice,
      InvoiceEvent.create(testInvoice.id, null, 'queued'),
      null,
    );
    expect(test.eventBus.publishBestEffort).not.toHaveBeenCalled();
  });

  it('reserves live billing and credits and invalidates cache after commit', async () => {
    const f = build();
    const invoice = newInvoice(undefined, 'live');
    await f.service.submit(
      invoice,
      InvoiceEvent.create(invoice.id, null, 'queued'),
      null,
    );
    expect(f.order).toEqual([
      'lock',
      'reserve',
      'credit',
      'invoice',
      'event',
      'outbox',
      'commit',
      'cache',
    ]);
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: -1,
        reservedInvoiceId: invoice.id,
        periodId: 'period-1',
        isReservation: true,
      }),
      tenantId,
    );
  });

  it('marks the reservation as avulso, with no period, when the avulso balance pays', async () => {
    const f = build();
    f.usage.reserve.mockResolvedValueOnce(null as never);
    const invoice = newInvoice(undefined, 'live');
    await f.service.submit(
      invoice,
      InvoiceEvent.create(invoice.id, null, 'queued'),
      null,
    );
    const saved = (f.credits.save.mock.calls as unknown[][])[0]![0] as Record<
      string,
      unknown
    >;
    expect(saved).toMatchObject({
      amount: -1,
      source: 'avulso',
      isReservation: true,
    });
    expect(saved.periodId).toBeUndefined();
  });

  it('refunds an avulso reservation back into the avulso pool', async () => {
    const f = build();
    const invoice = newInvoice(undefined, 'live');
    f.invoices.findByIdAndTenantId.mockResolvedValue({ status: 'processing' });
    f.credits.findByReservedInvoiceId.mockResolvedValue(
      CreditTransaction.create({
        tenantId,
        amount: -1,
        type: 'invoice_authorized',
        source: 'avulso',
        isReservation: true,
        createdAt: new Date(),
      }),
    );
    invoice.transitionTo('processing');
    invoice.transitionTo('rejected');
    await f.service.transition(
      invoice,
      InvoiceEvent.create(invoice.id, 'processing', 'rejected'),
    );
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1,
        type: 'invoice_rejected',
        source: 'avulso',
      }),
      tenantId,
    );
  });

  it('announces a live rejection but not a test one', async () => {
    const live = build();
    live.invoices.findByIdAndTenantId.mockResolvedValue({
      status: 'processing',
    });
    const liveInvoice = newInvoice(undefined, 'live');
    liveInvoice.transitionTo('processing');
    liveInvoice.setRejected('E1', 'CNPJ inválido');
    liveInvoice.transitionTo('rejected');
    await live.service.transition(
      liveInvoice,
      InvoiceEvent.create(liveInvoice.id, 'processing', 'rejected'),
    );
    expect(live.eventBus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        notice: {
          kind: 'invoice-rejected',
          invoiceId: liveInvoice.id,
          reason: 'CNPJ inválido',
        },
      }),
    );

    const test = build();
    test.invoices.findByIdAndTenantId.mockResolvedValue({
      status: 'processing',
    });
    const testInvoice = newInvoice(undefined, 'test');
    testInvoice.transitionTo('processing');
    testInvoice.setRejected('E1', 'x');
    testInvoice.transitionTo('rejected');
    await test.service.transition(
      testInvoice,
      InvoiceEvent.create(testInvoice.id, 'processing', 'rejected'),
    );
    expect(test.eventBus.publishBestEffort).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'account.notice' }),
    );
  });

  it('propagates persistence failures and skips cache invalidation', async () => {
    const f = build();
    const invoice = newInvoice(undefined, 'live');
    f.outbox.enqueue.mockRejectedValueOnce(new Error('outbox down'));
    await expect(
      f.service.submit(
        invoice,
        InvoiceEvent.create(invoice.id, null, 'queued'),
        null,
      ),
    ).rejects.toThrow('outbox down');
    expect(f.order).not.toContain('commit');
    expect(f.cache.delete).not.toHaveBeenCalled();
  });

  it('checks idempotency in the correct environment before reserving usage', async () => {
    const f = build();
    const invoice = newInvoice(undefined, 'live', 'same-key');
    f.invoices.findByIdempotencyKey.mockResolvedValueOnce(invoice);
    await expect(
      f.service.submit(
        invoice,
        InvoiceEvent.create(invoice.id, null, 'queued'),
        null,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    expect(f.invoices.findByIdempotencyKey).toHaveBeenCalledWith(
      invoice.idempotencyKey,
      tenantId,
      'live',
    );
    expect(f.usage.reserve).not.toHaveBeenCalled();
  });

  it('rejects an event for a different invoice', async () => {
    const f = build();
    await expect(
      f.service.submit(
        newInvoice(),
        InvoiceEvent.create('other', null, 'queued'),
        null,
      ),
    ).rejects.toThrow('identity mismatch');
    expect(f.invoices.insert).not.toHaveBeenCalled();
  });

  it.each(['authorized', 'rejected', 'failed'] as const)(
    'settles a live %s transition once',
    async (status) => {
      const f = build();
      const invoice = newInvoice(undefined, 'live');
      f.invoices.findByIdAndTenantId.mockResolvedValue({
        status: 'processing',
      });
      f.credits.findByReservedInvoiceId.mockResolvedValue(
        CreditTransaction.create({
          tenantId,
          amount: -1,
          type: 'invoice_authorized',
          isReservation: true,
          createdAt: new Date(),
        }),
      );
      invoice.transitionTo('processing');
      invoice.transitionTo(status);
      const event = InvoiceEvent.create(invoice.id, 'processing', status);
      await f.service.transition(invoice, event);
      expect(f.usage.settle).toHaveBeenCalledWith(invoice.id, tenantId, status);
      expect(f.credits.confirm).toHaveBeenCalledTimes(1);
      if (status === 'authorized')
        expect(f.credits.save).not.toHaveBeenCalled();
      else
        expect(f.credits.save).toHaveBeenCalledWith(
          expect.objectContaining({
            amount: 1,
            type: 'invoice_rejected',
            isReservation: false,
          }),
          tenantId,
        );
      f.invoices.findByIdAndTenantId.mockResolvedValue({ status });
      await f.service.transition(invoice, event);
      expect(f.events.save).toHaveBeenCalledTimes(1);
      expect(f.usage.settle).toHaveBeenCalledTimes(1);
      expect(f.credits.confirm).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a stale transition before writes', async () => {
    const f = build();
    const invoice = newInvoice();
    invoice.setRejected('code', 'reason');
    f.invoices.findByIdAndTenantId.mockResolvedValue({ status: 'authorized' });
    await expect(
      f.service.transition(
        invoice,
        InvoiceEvent.create(invoice.id, 'queued', 'rejected'),
      ),
    ).rejects.toThrow('Concurrent invoice transition');
    expect(f.invoices.save).not.toHaveBeenCalled();
  });
});

describe('InvoiceLifecycleService.submitBatch', () => {
  const entry = (
    environment: 'test' | 'live' = 'test',
    idempotencyKey?: string,
  ) => {
    const invoice = newInvoice(undefined, environment, idempotencyKey);
    return {
      invoice,
      event: InvoiceEvent.create(invoice.id, null, 'queued'),
      requestHash: 'hash-1',
    };
  };
  const stored = (requestHash: string) => ({
    toSnapshot: () => ({ requestHash }),
  });

  it('runs one unit of work and one billing lock for N entries', async () => {
    const f = build();
    const outcomes = await f.service.submitBatch(tenantId, [
      entry(),
      entry(),
      entry(),
    ]);
    expect(outcomes).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(f.unitOfWork.execute).toHaveBeenCalledTimes(1);
    expect(f.billing.locked).toHaveBeenCalledTimes(1);
    expect(f.order.filter((step) => step === 'commit')).toHaveLength(1);
  });

  it('saves invoice, event and outbox row for every accepted entry', async () => {
    const f = build();
    const entries = [entry(), entry()];
    await f.service.submitBatch(tenantId, entries);
    expect(f.invoices.insert).toHaveBeenCalledTimes(2);
    expect(f.events.save).toHaveBeenCalledTimes(2);
    for (const { invoice } of entries)
      expect(f.outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'invoice.calculate-taxes',
          aggregateId: invoice.id,
          dedupeKey: `calc:${invoice.id}`,
        }),
      );
  });

  it('rejects an entry whose idempotency key exists with a different payload, without writing it', async () => {
    const f = build();
    f.invoices.findByIdempotencyKey.mockResolvedValueOnce(stored('other'));
    const outcomes = await f.service.submitBatch(tenantId, [
      entry('test', 'taken'),
      entry(),
    ]);
    expect(outcomes[0]).toMatchObject({
      ok: false,
      code: 'ERROR_IDEMPOTENCY_CONFLICT',
    });
    expect(outcomes[1]).toEqual({ ok: true });
    expect(f.invoices.insert).toHaveBeenCalledTimes(1);
  });

  it('replays an entry whose idempotency key was committed meanwhile with the same payload', async () => {
    const f = build();
    const winner = stored('hash-1');
    f.invoices.findByIdempotencyKey.mockResolvedValueOnce(winner);
    const outcomes = await f.service.submitBatch(tenantId, [
      entry('live', 'taken'),
    ]);
    expect(outcomes).toEqual([{ ok: true, replayed: winner }]);
    expect(f.invoices.insert).not.toHaveBeenCalled();
    expect(f.usage.reserve).not.toHaveBeenCalled();
    expect(f.eventBus.publishBestEffort).not.toHaveBeenCalled();
  });

  it('does not fail a committed batch when the credit cache invalidation fails', async () => {
    const f = build();
    f.cache.delete.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      f.service.submitBatch(tenantId, [entry('live')]),
    ).resolves.toEqual([{ ok: true }]);
  });

  it('does not fail a committed submit when the credit cache invalidation fails', async () => {
    const f = build();
    f.cache.delete.mockRejectedValueOnce(new Error('redis down'));
    const invoice = newInvoice(undefined, 'live');
    await expect(
      f.service.submit(
        invoice,
        InvoiceEvent.create(invoice.id, null, 'queued'),
        null,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects entries once usage.reserve throws BillingRuleError, keeps the earlier ones', async () => {
    const f = build();
    f.usage.reserve
      .mockResolvedValueOnce('period-1')
      .mockResolvedValueOnce('period-1')
      .mockRejectedValueOnce(
        new BillingRuleError(
          'monthly_limit_exceeded',
          'Monthly processing limit reached',
        ),
      );
    const outcomes = await f.service.submitBatch(tenantId, [
      entry('live'),
      entry('live'),
      entry('live'),
    ]);
    expect(outcomes).toEqual([
      { ok: true },
      { ok: true },
      {
        ok: false,
        code: 'ERROR_MONTHLY_LIMIT_EXCEEDED',
        message: 'Monthly processing limit reached',
      },
    ]);
    expect(f.invoices.insert).toHaveBeenCalledTimes(2);
    expect(f.credits.save).toHaveBeenCalledTimes(2);
  });

  it('does not reserve credits in test environment', async () => {
    const f = build();
    await f.service.submitBatch(tenantId, [entry('test')]);
    expect(f.usage.reserve).not.toHaveBeenCalled();
    expect(f.credits.save).not.toHaveBeenCalled();
  });

  it('publishes the credits usage event once after a live batch', async () => {
    const f = build();
    await f.service.submitBatch(tenantId, [entry('live'), entry('live')]);
    expect(f.cache.delete).toHaveBeenCalledTimes(1);
    expect(f.eventBus.publishBestEffort).toHaveBeenCalledTimes(1);
  });

  it('rethrows unexpected errors so nothing is committed', async () => {
    const f = build();
    f.outbox.enqueue.mockRejectedValueOnce(new Error('db down'));
    await expect(
      f.service.submitBatch(tenantId, [entry(), entry()]),
    ).rejects.toThrow('db down');
    expect(f.order).not.toContain('commit');
  });
});
