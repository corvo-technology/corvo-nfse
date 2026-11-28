import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { IOutboxRepository } from '../domain/outbox.repository';
import { StalledQueuedRecoveryScheduler } from './stalled-queued-recovery.scheduler';

describe('StalledQueuedRecoveryScheduler', () => {
  const reviveStalledInvoices = jest.fn();
  const kinds: string[] = [];
  const build = (tenants: string[]) =>
    new StalledQueuedRecoveryScheduler(
      {
        visit: async (kind: string, work: (t: string) => Promise<void>) => {
          kinds.push(kind);
          for (const t of tenants) await work(t);
        },
      } as unknown as TenantWorkDiscovery,
      { reviveStalledInvoices } as unknown as IOutboxRepository,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    kinds.length = 0;
  });

  it('revives, per workspace, invoices queued for more than 30 minutes', async () => {
    reviveStalledInvoices.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const before = Date.now();

    await expect(build(['a', 'b']).run()).resolves.toBe(2);

    expect(kinds).toEqual(['stalled-queued']);
    expect(reviveStalledInvoices).toHaveBeenCalledTimes(2);
    const [tenant, createdBefore, limit] = reviveStalledInvoices.mock
      .calls[0] as [string, Date, number];
    expect(tenant).toBe('a');
    expect(limit).toBe(100);
    expect(before - createdBefore.getTime()).toBeGreaterThanOrEqual(
      30 * 60_000,
    );
  });

  it('stops at the budget of the run, shared by all workspaces', async () => {
    reviveStalledInvoices.mockResolvedValueOnce(100);

    await expect(build(['a', 'b']).run()).resolves.toBe(100);

    expect(reviveStalledInvoices).toHaveBeenCalledTimes(1);
  });
});
