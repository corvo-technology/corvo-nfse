export const LIVE_INVOICE_AUTHORIZED = 'invoice.live.authorized';

/** A live (production) invoice was authorized. Never published for test invoices. */
export type LiveInvoiceAuthorizedEvent = {
  name: typeof LIVE_INVOICE_AUTHORIZED;
  tenantId: string;
  invoiceId: string;
  authorizedAt: Date;
  /** The customer's copy is going out by e-mail. */
  customerEmailed: boolean;
};

export function liveInvoiceAuthorized(
  tenantId: string,
  input: Pick<
    LiveInvoiceAuthorizedEvent,
    'invoiceId' | 'authorizedAt' | 'customerEmailed'
  >,
): LiveInvoiceAuthorizedEvent {
  return { name: LIVE_INVOICE_AUTHORIZED, tenantId, ...input };
}
