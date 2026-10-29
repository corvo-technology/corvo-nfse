import {
  InvoiceCancellationPort,
  type CancelInvoiceCommand,
  type CancelInvoiceResult,
} from '../domain/invoice-cancellation.port';

/** Records the cancellations asked for and answers with a configurable result. */
export class FakeCancellation extends InvoiceCancellationPort {
  calls: CancelInvoiceCommand[] = [];
  result: CancelInvoiceResult = { ok: true };
  cancel(command: CancelInvoiceCommand) {
    this.calls.push(command);
    return Promise.resolve(this.result);
  }
}
