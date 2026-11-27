import { QUEUE_RETENTION } from '@/infra/redis/queue-retention';
import { queueFor } from '@/infra/redis/queue-routing';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';

export const INVOICE_EMIT = 'invoice.emit';

@Injectable()
export class InvoiceEmitHandler implements OutboxHandler, OnModuleInit {
  readonly type = INVOICE_EMIT;

  constructor(
    private readonly queue: BullmqQueueService,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { invoiceId, companyId, tenantId } = message.payload as {
      invoiceId: string;
      companyId: string;
      tenantId: string;
    };
    await this.queue.add(
      queueFor('nfse-emission', message.environment),
      'process',
      { invoiceId, companyId, tenantId },
      {
        idempotencyKey: `emission-${invoiceId}`,
        attempts: 5,
        backoffMs: 5000,
        ...QUEUE_RETENTION['nfse-emission'],
      },
    );
  }
}
