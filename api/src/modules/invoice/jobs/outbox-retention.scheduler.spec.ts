import type { ConfigService } from '@nestjs/config';
import type { IOutboxRetention } from '../domain/outbox-retention';
import { OutboxRetentionScheduler } from './outbox-retention.scheduler';

describe('OutboxRetentionScheduler', () => {
  const build = (enabled: boolean | undefined) => {
    const purge = jest.fn(() => Promise.resolve());
    const retention: IOutboxRetention = { purge };
    const config = { get: () => enabled } as unknown as ConfigService;
    return {
      purge,
      scheduler: new OutboxRetentionScheduler(retention, config),
    };
  };

  it('is a dry run unless DATA_RETENTION_ENABLED is true', async () => {
    const now = new Date();
    const unset = build(undefined);
    await unset.scheduler.run(now);
    expect(unset.purge).toHaveBeenCalledWith(false, now);
    const off = build(false);
    await off.scheduler.run(now);
    expect(off.purge).toHaveBeenCalledWith(false, now);
  });

  it('deletes when it is true', async () => {
    const now = new Date();
    const on = build(true);
    await on.scheduler.run(now);
    expect(on.purge).toHaveBeenCalledWith(true, now);
  });
});
