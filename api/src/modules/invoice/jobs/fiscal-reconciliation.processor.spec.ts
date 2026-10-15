import { Job } from 'bullmq';
import type { LockPort } from '@/infra/redis/lock.port';
import { FiscalReconciliationProcessor } from './fiscal-reconciliation.processor';
import type { FiscalReconciliationService } from '../application/fiscal/fiscal-reconciliation.service';

const fakeLock: LockPort = {
  acquire: jest.fn(),
  release: jest.fn(),
  extend: jest.fn(),
  withLock: jest.fn(),
  withRenewingLock: jest.fn(),
};

const fakeService: Pick<FiscalReconciliationService, 'reconcileInvoice'> = {
  reconcileInvoice: jest.fn(),
};

const jobData = {
  invoiceId: 'a1a1a1a1-1111-4111-8111-111111111111',
  tenantId: 'e5e5e5e5-5555-4555-8555-555555555555',
};

describe('FiscalReconciliationProcessor', () => {
  let lock: { key: string; token: string; ttlMs: number };

  beforeEach(() => {
    jest.clearAllMocks();
    lock = { key: 'nfse:fiscal-reconcile:' + jobData.invoiceId, token: 'tok', ttlMs: 60_000 };
    jest.mocked(fakeLock.acquire).mockResolvedValue(lock);
    jest.mocked(fakeLock.release).mockResolvedValue(true);
    jest.mocked(fakeService.reconcileInvoice).mockResolvedValue(undefined);
  });

  function buildProcessor(): FiscalReconciliationProcessor {
    return new FiscalReconciliationProcessor(
      fakeLock,
      fakeService as FiscalReconciliationService,
    );
  }

  it('acquires the per-invoice lock and delegates to the service', async () => {
    await buildProcessor().process({ data: jobData } as Job<typeof jobData>);

    expect(fakeLock.acquire).toHaveBeenCalledWith(
      'nfse:fiscal-reconcile:a1a1a1a1-1111-4111-8111-111111111111',
      { ttlMs: 60_000 },
    );
    expect(fakeService.reconcileInvoice).toHaveBeenCalledWith(
      jobData.invoiceId,
      jobData.tenantId,
    );
  });

  it('releases the lock after a successful run', async () => {
    await buildProcessor().process({ data: jobData } as Job<typeof jobData>);

    expect(fakeLock.release).toHaveBeenCalledWith(lock);
  });

  it('throws when the lock is already held so BullMQ retries the job', async () => {
    jest.mocked(fakeLock.acquire).mockResolvedValue(null);

    await expect(
      buildProcessor().process({ data: jobData } as Job<typeof jobData>),
    ).rejects.toThrow('already being processed');
    expect(fakeService.reconcileInvoice).not.toHaveBeenCalled();
    expect(fakeLock.release).not.toHaveBeenCalled();
  });

  it('releases the lock and rethrows when the service fails', async () => {
    jest
      .mocked(fakeService.reconcileInvoice)
      .mockRejectedValue(new Error('store down'));

    await expect(
      buildProcessor().process({ data: jobData } as Job<typeof jobData>),
    ).rejects.toThrow('store down');
    expect(fakeLock.release).toHaveBeenCalledWith(lock);
  });
});
