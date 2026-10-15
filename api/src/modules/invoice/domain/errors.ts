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

export class InvoiceNotCancellableError extends Error {
  constructor(status: InvoiceStatus) {
    super(`Invoice in status '${status}' cannot be cancelled`);
    this.name = 'InvoiceNotCancellableError';
  }
}

export class InvalidCancellationReasonError extends Error {
  constructor() {
    super('Cancellation description must have 15 to 255 characters');
    this.name = 'InvalidCancellationReasonError';
  }
}

/** Another writer changed the invoice status between load and commit. */
export class ConcurrentInvoiceTransitionError extends Error {
  constructor(readonly invoiceId: string) {
    super('Concurrent invoice transition');
    this.name = 'ConcurrentInvoiceTransitionError';
  }
}
