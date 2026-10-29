import {
  InvalidCancellationReasonError,
  InvoiceNotCancellableError,
  InvoiceNotFoundError,
} from '../domain/errors';
import type { InvoiceService } from './invoice.service';
import { IntegrationInvoiceCanceller } from './integration-invoice-canceller';

const command = {
  tenantId: 'tenant-1',
  environment: 'test' as const,
  invoiceId: 'inv-1',
  description: 'Cancelado por reembolso',
};

function setup(cancel: jest.Mock) {
  return new IntegrationInvoiceCanceller({
    cancel,
  } as unknown as InvoiceService);
}

describe('IntegrationInvoiceCanceller', () => {
  it('cancels through the normal path with the reason "other" and the given description', async () => {
    const cancel = jest.fn().mockResolvedValue({ status: 'cancelling' });
    await expect(setup(cancel).cancel(command)).resolves.toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledWith('inv-1', 'tenant-1', 'test', {
      reason: 'other',
      description: 'Cancelado por reembolso',
    });
  });

  it('an invoice that cannot be cancelled as it is becomes a refusal with the reason, not an exception', async () => {
    for (const error of [
      new InvoiceNotCancellableError('retry_pending'),
      new InvalidCancellationReasonError(),
      new InvoiceNotFoundError('inv-1'),
    ]) {
      const result = await setup(jest.fn().mockRejectedValue(error)).cancel(
        command,
      );
      expect(result).toEqual({ ok: false, message: expect.any(String) });
    }
  });

  it('anything else is thrown so the caller retries', async () => {
    await expect(
      setup(jest.fn().mockRejectedValue(new Error('db down'))).cancel(command),
    ).rejects.toThrow('db down');
  });
});
