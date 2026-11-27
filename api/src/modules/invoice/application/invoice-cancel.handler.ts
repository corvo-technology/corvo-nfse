import { QUEUE_RETENTION } from '@/infra/redis/queue-retention';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { OutboxHandler } from '../domain/outbox-handler';
import type { NewOutboxMessage, OutboxMessage } from '../domain/outbox-message';
import type { Invoice } from '../domain/invoice';
import type { InvoiceEvent } from '../domain/invoice-event';
import { OutboxHandlerRegistry } from './outbox-handler.registry';

export const INVOICE_CANCEL = 'invoice.cancel';

/** Each request has its own key, so a cancellation retried after a rejection is a new message. */
export function cancellationMessage(
  invoice: Invoice,
  event: InvoiceEvent,
): NewOutboxMessage {
  return {
    tenantId: invoice.tenantId,
    environment: invoice.environment,
    type: INVOICE_CANCEL,
    aggregateId: invoice.id,
    dedupeKey: `cancellation:${event.id}`,
    payload: {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      tenantId: invoice.tenantId,
      requestId: event.id,
    },
  };
}

@Injectable()
export class InvoiceCancelHandler implements OutboxHandler, OnModuleInit {
  readonly type = INVOICE_CANCEL;

  constructor(
    private readonly queue: BullmqQueueService,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { invoiceId, companyId, tenantId, requestId } = message.payload as {
      invoiceId: string;
      companyId: string;
      tenantId: string;
      requestId: string;
    };
    await this.queue.add(
      'nfse-cancellation',
      'cancel',
      { invoiceId, companyId, tenantId },
      {
        idempotencyKey: `cancellation-${requestId}`,
        attempts: 8,
        backoffMs: 60000,
        ...QUEUE_RETENTION['nfse-cancellation'],
      },
    );
  }
}
