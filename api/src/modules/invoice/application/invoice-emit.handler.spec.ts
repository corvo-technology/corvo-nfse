import { QUEUE_RETENTION } from '@/infra/redis/queue-retention';
import { InvoiceEmitHandler, INVOICE_EMIT } from './invoice-emit.handler';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';

describe('InvoiceEmitHandler', () => {
  const queue = { add: jest.fn().mockResolvedValue({ id: 'emission-i1' }) };

  const message = (environment: 'live' | 'test') => ({
    id: 'm1',
    tenantId: 't1',
    environment,
    type: INVOICE_EMIT,
    aggregateId: 'i1',
    dedupeKey: 'emission:i1',
    status: 'claimed' as const,
    availableAt: new Date(),
    leaseUntil: null,
    attempts: 1,
    lastError: null,
    payload: { invoiceId: 'i1', companyId: 'c1', tenantId: 't1' },
  });

  it.each([
    ['live', 'nfse-emission'],
    ['test', 'nfse-emission-test'],
  ] as const)(
    'publishes a %s message on %s with the same jobId and options',
    async (environment, queueName) => {
      queue.add.mockClear();
      const handler = new InvoiceEmitHandler(
        queue as never,
        new OutboxHandlerRegistry(),
      );
      await handler.handle(message(environment));
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        queueName,
        'process',
        { invoiceId: 'i1', companyId: 'c1', tenantId: 't1' },
        {
          idempotencyKey: 'emission-i1',
          attempts: 5,
          backoffMs: 5000,
          ...QUEUE_RETENTION['nfse-emission'],
        },
      );
    },
  );

  it('registers itself on module init', () => {
    const registry = new OutboxHandlerRegistry();
    const handler = new InvoiceEmitHandler(queue as never, registry);
    handler.onModuleInit();
    expect(registry.get(INVOICE_EMIT)).toBe(handler);
  });
});
