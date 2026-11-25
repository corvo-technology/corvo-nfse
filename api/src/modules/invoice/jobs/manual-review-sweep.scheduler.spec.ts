import type { ConfigService } from '@nestjs/config';
import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { IInvoiceRepository } from '../domain/invoice.repository';
import { ManualReviewSweepScheduler } from './manual-review-sweep.scheduler';

describe('ManualReviewSweepScheduler', () => {
  const findManualReview = jest.fn();
  const add = jest.fn();
  const settings: Record<string, unknown> = {};
  const build = (tenants: string[]) =>
    new ManualReviewSweepScheduler(
      {
        visit: async (_k: string, work: (t: string) => Promise<void>) => {
          for (const t of tenants) await work(t);
        },
      } as unknown as TenantWorkDiscovery,
      { findManualReview } as unknown as IInvoiceRepository,
      { add } as unknown as BullmqQueueService,
      { get: (k: string) => settings[k] } as unknown as ConfigService,
    );
  const rows = (tenantId: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${tenantId}-${i}`,
      tenantId,
      companyId: 'c',
    }));

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(settings)) delete settings[k];
    settings.MANUAL_REVIEW_SWEEP_BATCH = 3;
    settings.MANUAL_REVIEW_SWEEP_MAX_AGE_DAYS = 30;
    add.mockResolvedValue({});
  });

  it('queues query-only checks and respects the batch across tenants', async () => {
    findManualReview.mockImplementation((t: string, _s: Date, limit: number) =>
      Promise.resolve(rows(t, Math.min(limit, 2))),
    );

    await build(['a', 'b', 'c']).handle();

    expect(add).toHaveBeenCalledTimes(3);
    for (const [queue, , data] of add.mock.calls as unknown[][]) {
      expect(queue).toBe('nfse-reconciliation');
      expect(data).toMatchObject({ review: 'sweep' });
    }
    expect(findManualReview).toHaveBeenCalledTimes(2);
    expect(findManualReview).toHaveBeenNthCalledWith(
      2,
      'b',
      expect.any(Date),
      1,
    );
  });

  it('skips invoices older than the age limit', async () => {
    findManualReview.mockResolvedValue([]);
    await build(['a']).handle();
    const since = (findManualReview.mock.calls as unknown[][])[0][1] as Date;
    const days = (Date.now() - since.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(30, 1);
  });

  it('does nothing when disabled', async () => {
    settings.MANUAL_REVIEW_SWEEP_ENABLED = false;
    await build(['a']).handle();
    expect(findManualReview).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
