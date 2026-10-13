import { InvoiceStatus } from './invoice-status';

export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice not found: ${invoiceId}`);
    this.name = 'InvoiceNotFoundError';
  }
}

export class InvalidInvoiceTransitionError extends Error {
  constructor(from: InvoiceStatus, to: InvoiceStatus) {
    super(`Invalid invoice transition from '${from}' to '${to}'`);
    this.name = 'InvalidInvoiceTransitionError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key already used with different payload: ${key}`);
    this.name = 'IdempotencyConflictError';
  }
}
