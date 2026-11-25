import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { IAccountAuditRepository } from '../domain/account-audit.repository';
import { AccountAuditRetentionScheduler } from './account-audit-retention.scheduler';

describe('AccountAuditRetentionScheduler', () => {
  it('deletes events older than 365 days for every tenant with old rows', async () => {
    const deleteOlderThan = jest.fn().mockResolvedValue(3);
    const visit = jest.fn(
      async (_kind: string, work: (tenantId: string) => Promise<void>) => {
        await work('t1');
        await work('t2');
      },
    );
    const scheduler = new AccountAuditRetentionScheduler(
      { visit } as unknown as TenantWorkDiscovery,
      { deleteOlderThan } as unknown as IAccountAuditRepository,
    );
    const now = new Date('2026-11-24T03:00:00.000Z');
    await scheduler.run(now);
    expect(visit).toHaveBeenCalledWith(
      'account-audit-retention',
      expect.any(Function),
    );
    const cutoff = new Date('2025-11-24T03:00:00.000Z');
    expect(deleteOlderThan).toHaveBeenNthCalledWith(1, 't1', cutoff);
    expect(deleteOlderThan).toHaveBeenNthCalledWith(2, 't2', cutoff);
  });
});
