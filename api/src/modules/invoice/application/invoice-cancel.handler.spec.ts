import { QUEUE_RETENTION } from '@/infra/redis/queue-retention';
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import {
  INVOICE_CANCEL,
  InvoiceCancelHandler,
  cancellationMessage,
} from './invoice-cancel.handler';
import { OutboxHandlerRegistry } from './outbox-handler.registry';

describe('InvoiceCancelHandler', () => {
  it('builds one outbox message per cancellation request', () => {
    const created = Invoice.create(
      {
        companyId: 'c1',
        environment: 'live',
        customer: { taxId: VALID_CNPJ, name: 'Cliente' },
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2026-10-14'),
      },
      't1',
    );
    const invoice = Invoice.reconstitute({
      ...created.toSnapshot(),
      status: 'authorized',
      authorizedAt: new Date(),
    });
    const event = invoice.requestCancellation(
      cancellationReason('issue_error', 'Valor informado incorretamente'),
    );
    expect(cancellationMessage(invoice, event)).toEqual({
      tenantId: 't1',
      environment: 'live',
      type: INVOICE_CANCEL,
      aggregateId: invoice.id,
      dedupeKey: `cancellation:${event.id}`,
      payload: {
        invoiceId: invoice.id,
        companyId: 'c1',
        tenantId: 't1',
        requestId: event.id,
      },
    });
  });

  it('publishes nfse-cancellation with a per-request job id', async () => {
    const queue = { add: jest.fn() };
    const handler = new InvoiceCancelHandler(
      queue as never,
      new OutboxHandlerRegistry(),
    );
    await handler.handle({
      id: 'm1',
      tenantId: 't1',
      environment: 'live',
      type: INVOICE_CANCEL,
      aggregateId: 'i1',
      dedupeKey: 'cancellation:e1',
      status: 'claimed',
      availableAt: new Date(),
      leaseUntil: null,
      attempts: 1,
      lastError: null,
      payload: {
        invoiceId: 'i1',
        companyId: 'c1',
        tenantId: 't1',
        requestId: 'e1',
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'nfse-cancellation',
      'cancel',
      { invoiceId: 'i1', companyId: 'c1', tenantId: 't1' },
      {
        idempotencyKey: 'cancellation-e1',
        attempts: 8,
        backoffMs: 60000,
        ...QUEUE_RETENTION['nfse-cancellation'],
      },
    );
  });

  it('registers itself on module init', () => {
    const registry = new OutboxHandlerRegistry();
    const handler = new InvoiceCancelHandler({} as never, registry);
    handler.onModuleInit();
    expect(registry.get(INVOICE_CANCEL)).toBe(handler);
  });
});
