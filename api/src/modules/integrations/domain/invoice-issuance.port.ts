import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import type { IntegrationEnvironment } from './connector';

export interface IssueInvoiceCommand {
  tenantId: string;
  environment: IntegrationEnvironment;
  request: CreateInvoiceDto;
  idempotencyKey: string;
}

/** The only way the integrations module asks for an invoice. */
export abstract class InvoiceIssuancePort {
  /**
   * Issues through the normal emission path. A repeated call with the same
   * key and request returns the existing invoice with `replay: true`.
   */
  abstract issue(
    command: IssueInvoiceCommand,
  ): Promise<{ invoiceId: string; replay: boolean }>;
}
