import type { NewOutboxMessage } from '../domain/outbox-message';
import type { EntityManager } from 'typeorm';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { Invoice } from '../domain/invoice';
import { InvoiceEvent } from '../domain/invoice-event';
import { InvoiceEventOrmEntity } from '../infra/invoice-event.orm-entity';
import { InvoiceOrmEntity } from '../infra/invoice.orm-entity';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';

function build(
  outbox: { enqueue: jest.Mock },
  order: string[] = [],
  context = new TypeOrmTransactionContext(),
) {
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: (entity: unknown) => ({
      existsBy: jest.fn().mockResolvedValue(false),
      insert: jest.fn(async () => {
        order.push(
          entity === InvoiceOrmEntity
            ? 'invoice'
            : entity === InvoiceEventOrmEntity
              ? 'event'
              : 'other',
        );
      }),
    }),
  };
  const database = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<void>) =>
      work(manager),
    ),
  };
  const usage = {
    reserve: jest.fn(async () => {
      expect(context.getManager()).toBe(manager);
      order.push('reserve');
      return 'period-1';
    }),
    settle: jest.fn(),
  };
  const service = new InvoiceLifecycleService(
    database as never,
    { delete: jest.fn() } as never,
    usage as never,
    context,
    outbox as never,
  );
  return { service, database, manager, context, usage };
}

const newInvoice = (
  scheduledFor?: Date,
  environment: 'test' | 'live' = 'test',
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
  );

describe('InvoiceLifecycleService.submit + outbox', () => {
  it('enqueues invoice.calculate-taxes after the invoice and event inserts, in the same transaction', async () => {
    const order: string[] = [];
    const outbox = {
      enqueue: jest.fn(async () => {
        order.push('outbox');
        return true;
      }),
    };
    const { service, database } = build(outbox, order);
    const invoice = newInvoice();
    await service.submit(
      invoice,
      InvoiceEvent.create(invoice.id, null, 'queued'),
      null,
    );
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['invoice', 'event', 'outbox']);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        environment: 'test',
        type: 'invoice.calculate-taxes',
        aggregateId: invoice.id,
        dedupeKey: `calc:${invoice.id}`,
        payload: { invoiceId: invoice.id, companyId, tenantId },
      }),
    );
    // Emission is not released at intake: the calculate-taxes handler
    // enqueues invoice.emit only after the fiscal calculation succeeds.
    expect(outbox.enqueue.mock.calls[0][0].type).not.toBe('invoice.emit');
  });

  it('uses scheduledFor as availableAt for a scheduled invoice and "now" otherwise', async () => {
    const outbox = {
      enqueue: jest
        .fn<Promise<boolean>, [NewOutboxMessage]>()
        .mockResolvedValue(true),
    };
    const { service } = build(outbox);
    const when = new Date('2099-10-14T03:00:00.000Z');
    const scheduled = newInvoice(when);
    await service.submit(
      scheduled,
      InvoiceEvent.create(scheduled.id, null, 'queued'),
      null,
    );
    expect(outbox.enqueue.mock.calls[0][0].availableAt).toEqual(when);
    const immediate = newInvoice();
    await service.submit(
      immediate,
      InvoiceEvent.create(immediate.id, null, 'queued'),
      null,
    );
    expect(outbox.enqueue.mock.calls[1][0].availableAt).toBeUndefined();
  });

  it('propagates an outbox failure so the surrounding transaction rolls back', async () => {
    const outbox = { enqueue: jest.fn().mockRejectedValue(new Error('db')) };
    const { service } = build(outbox);
    const invoice = newInvoice();
    await expect(
      service.submit(
        invoice,
        InvoiceEvent.create(invoice.id, null, 'queued'),
        null,
      ),
    ).rejects.toThrow('db');
  });
  it('reserves live credit and enqueues using the same transaction manager', async () => {
    const order: string[] = [];
    const context = new TypeOrmTransactionContext();

    const outbox = {
      enqueue: jest.fn(async () => {
        expect(context.getManager()).toBe(expectedManager);
        order.push('outbox');
        return true;
      }),
    };
    const { service, manager, usage } = build(outbox, order, context);
    const expectedManager = manager as unknown as EntityManager;
    const invoice = newInvoice(undefined, 'live');
    await service.submit(
      invoice,
      InvoiceEvent.create(invoice.id, null, 'queued'),
      null,
    );
    expect(usage.reserve).toHaveBeenCalledWith(tenantId);
    expect(order).toEqual(['reserve', 'other', 'invoice', 'event', 'outbox']);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'live', tenantId }),
    );
    expect(context.getManager()).toBeUndefined();
  });
});
