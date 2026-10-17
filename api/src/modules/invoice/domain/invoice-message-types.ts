/**
 * Outbox message type released at invoice intake. The fiscal engine always
 * runs first; the handler enqueues `invoice.emit` only after a successful
 * calculation, so emission can never race ahead of the fiscal snapshot.
 *
 * Lives outside the handler file so intake (InvoiceLifecycleService) can
 * reference the type without an import cycle through the handler.
 */
export const INVOICE_CALCULATE_TAXES = 'invoice.calculate-taxes';
