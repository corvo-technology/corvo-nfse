/* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return */
import { PortalSyncScheduler } from './portal-sync.scheduler';

const targetsByTenant: Record<
  string,
  Array<{ companyId: string; environment: 'live' | 'test' }>
> = {
  'tenant-a': [
    { companyId: 'a1', environment: 'live' },
    { companyId: 'a2', environment: 'test' },
  ],
  'tenant-b': [{ companyId: 'b1', environment: 'live' }],
};

function setup(enabled: boolean | null = true) {
  const discovery = {
    visit: jest.fn(
      async (_kind: string, work: (tenantId: string) => Promise<void>) => {
        for (const tenantId of Object.keys(targetsByTenant))
          await work(tenantId);
      },
    ),
  };
  const repository = {
    listTargets: jest.fn((tenantId: string) =>
      Promise.resolve(targetsByTenant[tenantId]),
    ),
  };
  const sync = { sync: jest.fn().mockResolvedValue({ status: 'synced' }) };
  const config = { get: jest.fn().mockReturnValue(enabled ?? undefined) };
  const locks = {
    acquire: jest.fn((key: string) =>
      Promise.resolve({ key, token: 't', ttlMs: 1 }),
    ),
    release: jest.fn().mockResolvedValue(true),
  };
  const scheduler = new PortalSyncScheduler(
    discovery as never,
    repository as never,
    sync as never,
    config as never,
    locks as never,
  );
  return { scheduler, discovery, repository, sync, config, locks };
}

describe('PortalSyncScheduler', () => {
  it('does nothing unless PORTAL_SYNC_ENABLED is on', async () => {
    const { scheduler, discovery, config } = setup(false);

    await scheduler.handle();

    expect(config.get).toHaveBeenCalledWith('PORTAL_SYNC_ENABLED');
    expect(discovery.visit).not.toHaveBeenCalled();
  });

  it('is off when the setting is missing', async () => {
    const { scheduler, discovery } = setup(null);

    await scheduler.handle();

    expect(discovery.visit).not.toHaveBeenCalled();
  });

  it('syncs every company of every workspace, each inside its own workspace', async () => {
    const { scheduler, discovery, sync } = setup();

    await scheduler.handle();

    expect(discovery.visit).toHaveBeenCalledWith(
      'portal-sync',
      expect.any(Function),
    );
    expect(
      sync.sync.mock.calls.map((call) => [
        call[0],
        (call[1] as { companyId: string }).companyId,
      ]),
    ).toEqual([
      ['tenant-a', 'a1'],
      ['tenant-a', 'a2'],
      ['tenant-b', 'b1'],
    ]);
  });

  it('one company failing does not stop the others, and its lock is released', async () => {
    const { scheduler, sync, locks } = setup();
    sync.sync.mockRejectedValueOnce(new Error('boom'));

    await scheduler.handle();

    expect(sync.sync).toHaveBeenCalledTimes(3);
    expect(locks.release).toHaveBeenCalledTimes(3);
  });

  it('skips a company another worker is already reading', async () => {
    const { scheduler, sync, locks } = setup();
    locks.acquire.mockImplementation((key: string) =>
      Promise.resolve(
        key.includes('a1') ? null : { key, token: 't', ttlMs: 1 },
      ),
    );

    await scheduler.handle();

    expect(
      sync.sync.mock.calls.map(
        (call) => (call[1] as { companyId: string }).companyId,
      ),
    ).toEqual(['a2', 'b1']);
  });
});
