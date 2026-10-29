import { Inject, Injectable } from '@nestjs/common';
import {
  InvoiceIssuancePort,
  type IssueInvoiceCommand,
} from '@/modules/integrations/domain/invoice-issuance.port';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import { InvoiceService } from './invoice.service';

@Injectable()
export class IntegrationInvoiceIssuer extends InvoiceIssuancePort {
  constructor(
    private readonly invoices: InvoiceService,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
  ) {
    super();
  }

  async issue(
    command: IssueInvoiceCommand,
  ): Promise<{ invoiceId: string; replay: boolean }> {
    const existing = await this.invoiceRepo.findByIdempotencyKey(
      command.idempotencyKey,
      command.tenantId,
      command.environment,
    );
    const invoice = await this.invoices.emitInEnvironment(
      command.request,
      command.tenantId,
      command.environment,
      command.idempotencyKey,
    );
    return { invoiceId: invoice.id, replay: existing !== null };
  }
}
