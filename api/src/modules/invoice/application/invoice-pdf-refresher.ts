import { Injectable, Logger } from '@nestjs/common';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { Invoice } from '../domain/invoice';

/** Job name the doc-prep worker answers with "redo the stored PDF with the invoice's current mark". */
export const REFRESH_PDF_JOB = 'refresh-pdf';

/**
 * A cancelled or substituted invoice keeps the PDF made while it was valid. This asks the
 * worker to redo it with the CANCELADA / SUBSTITUÍDA watermark. One job per invoice (fixed key),
 * and the worker overwrites the same file, so asking twice changes nothing.
 */
@Injectable()
export class InvoicePdfRefresher {
  private readonly logger = new Logger(InvoicePdfRefresher.name);

  constructor(private readonly queues: BullmqQueueService) {}

  async request(invoice: Invoice): Promise<void> {
    // Never authorized (cancelled while queued): there is no PDF to mark.
    if (!invoice.wasAuthorized) return;
    const data = {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
    };
    try {
      await this.queues.add('nfse-doc-prep', REFRESH_PDF_JOB, data, {
        idempotencyKey: `pdf-refresh:${invoice.id}`,
        attempts: 5,
        backoffMs: 10_000,
        removeOnComplete: false,
        removeOnFail: 1000,
      });
    } catch (error: unknown) {
      this.logger.error(
        { err: error, invoiceId: invoice.id },
        'Could not queue the PDF refresh of a cancelled invoice',
      );
    }
  }
}
