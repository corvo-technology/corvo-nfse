import { Injectable } from '@nestjs/common';
import {
  InvoiceCancellationPort,
  type CancelInvoiceCommand,
  type CancelInvoiceResult,
} from '@/modules/integrations/domain/invoice-cancellation.port';
import {
  InvalidCancellationReasonError,
  InvoiceNotCancellableError,
  InvoiceNotFoundError,
} from '../domain/errors';
import { InvoiceService } from './invoice.service';

@Injectable()
export class IntegrationInvoiceCanceller extends InvoiceCancellationPort {
  constructor(private readonly invoices: InvoiceService) {
    super();
  }

  async cancel(command: CancelInvoiceCommand): Promise<CancelInvoiceResult> {
    try {
      await this.invoices.cancel(
        command.invoiceId,
        command.tenantId,
        command.environment,
        { reason: 'other', description: command.description },
      );
      return { ok: true };
    } catch (error) {
      if (
        error instanceof InvoiceNotCancellableError ||
        error instanceof InvalidCancellationReasonError ||
        error instanceof InvoiceNotFoundError
      )
        return { ok: false, message: error.message };
      throw error;
    }
  }
}
