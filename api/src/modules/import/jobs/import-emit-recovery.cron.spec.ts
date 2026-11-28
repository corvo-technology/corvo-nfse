import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { ImportRepository } from '../domain/import.repository';
import type { ImportEmitService } from '../application/import-emit.service';
import { ImportEmitRecoveryCron } from './import-emit-recovery.cron';

describe('ImportEmitRecoveryCron', () => {
  const listEmittingStartedBefore = jest.fn();
  const recover = jest.fn();
  const cron = new ImportEmitRecoveryCron(
    {
      visit: async (_k: string, work: (t: string) => Promise<void>) => {
        await work('t1');
      },
    } as unknown as TenantWorkDiscovery,
    { listEmittingStartedBefore } as unknown as ImportRepository,
    { recover } as unknown as ImportEmitService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('rechecks every import left emitting, in its own environment', async () => {
    listEmittingStartedBefore.mockResolvedValue([
      { id: 'a', environment: 'test' },
      { id: 'b', environment: 'live' },
    ]);
    recover.mockResolvedValue(undefined);

    await expect(cron.run()).resolves.toBe(2);

    expect(recover).toHaveBeenNthCalledWith(1, {
      tenantId: 't1',
      environment: 'test',
      importId: 'a',
    });
    expect(recover).toHaveBeenNthCalledWith(2, {
      tenantId: 't1',
      environment: 'live',
      importId: 'b',
    });
  });

  it('keeps going when one import fails', async () => {
    listEmittingStartedBefore.mockResolvedValue([
      { id: 'a', environment: 'test' },
      { id: 'b', environment: 'test' },
    ]);
    recover
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);

    await expect(cron.run()).resolves.toBe(1);
    expect(recover).toHaveBeenCalledTimes(2);
  });
});
