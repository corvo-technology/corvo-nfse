import type { IntegrationEnvironment } from './connector';

export interface CancelInvoiceCommand {
  tenantId: string;
  environment: IntegrationEnvironment;
  invoiceId: string;
  /** The fiscal reason text; 15 to 255 characters. */
  description: string;
}

/** `ok: false` means the invoice cannot be cancelled as it is; anything unexpected is thrown. */
export type CancelInvoiceResult = { ok: true } | { ok: false; message: string };

/** The only way the integrations module asks for an invoice to be cancelled. */
export abstract class InvoiceCancellationPort {
  /** Idempotent: asking again for an invoice already being cancelled is not an error. */
  abstract cancel(command: CancelInvoiceCommand): Promise<CancelInvoiceResult>;
}
