import type { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { Invoice } from '../domain/invoice';
import { InvoicePdfRefresher } from './invoice-pdf-refresher';

function invoice(
  wasAuthorized: boolean,
  environment: 'live' | 'test' = 'live',
): Invoice {
  return {
    environment,
    id: 'inv-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    wasAuthorized,
  } as unknown as Invoice;
}

describe('InvoicePdfRefresher', () => {
  const add = jest.fn();
  const refresher = new InvoicePdfRefresher({
    add,
  } as unknown as BullmqQueueService);

  beforeEach(() => add.mockReset().mockResolvedValue({ id: 'job' }));

  it('queues one refresh-pdf job per invoice, with a fixed key so retries do not pile up', async () => {
    await refresher.request(invoice(true));
    expect(add).toHaveBeenCalledWith(
      'nfse-doc-prep',
      'refresh-pdf',
      { invoiceId: 'inv-1', tenantId: 'tenant-1', companyId: 'company-1' },
      expect.objectContaining({ idempotencyKey: 'pdf-refresh:inv-1' }),
    );
  });

  it.each([
    ['live', 'nfse-doc-prep'],
    ['test', 'nfse-doc-prep-test'],
  ] as const)('a %s invoice is refreshed on %s', async (environment, queue) => {
    await refresher.request(invoice(true, environment));
    expect(add).toHaveBeenCalledTimes(1);
    const [usedQueue, , , options] = add.mock.calls[0] as unknown[];
    expect(usedQueue).toBe(queue);
    expect(options).toEqual(
      expect.objectContaining({ idempotencyKey: 'pdf-refresh:inv-1' }),
    );
  });

  it('skips an invoice that was never authorized (it never had a PDF)', async () => {
    await refresher.request(invoice(false));
    expect(add).not.toHaveBeenCalled();
  });

  it('does not throw when the queue is down', async () => {
    add.mockRejectedValue(new Error('redis down'));
    await expect(refresher.request(invoice(true))).resolves.toBeUndefined();
  });
});
