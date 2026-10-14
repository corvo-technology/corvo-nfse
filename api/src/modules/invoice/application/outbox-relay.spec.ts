import { ConfigService } from '@nestjs/config';
import { getDatabaseScope } from '@/infra/persistence/typeorm/tenant-context.storage';
import { recordOutboxPendingAge } from '../observability/outbox.metrics';
jest.mock('../observability/outbox.metrics');
import { OutboxRelay } from './outbox-relay';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import type { IOutboxRepository } from '../domain/outbox.repository';
import type { OutboxMessage } from '../domain/outbox-message';

const tenantId = '11111111-1111-4111-8111-111111111111';
const message = (over: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: 'm1',
  tenantId,
  environment: 'test',
  type: 'invoice.emit',
  aggregateId: 'a1',
  payload: {},
  dedupeKey: 'emission:a1',
  status: 'claimed',
  availableAt: new Date(),
  leaseUntil: new Date(),
  attempts: 1,
  lastError: null,
  ...over,
});
const config = {
  get: () => ({
    relayIntervalMs: 1000,
    batchSize: 10,
    leaseMs: 60000,
    maxAttempts: 3,
    scheduleMaxDays: 365,
  }),
};

function setup(claimed: OutboxMessage[], handle: jest.Mock) {
  const repo: jest.Mocked<IOutboxRepository> = {
    oldestPendingAvailableAt: jest.fn().mockResolvedValue(null),
    insert: jest.fn(),
    claimBatch: jest.fn().mockResolvedValue(claimed),
    complete: jest.fn(),
    release: jest.fn(),
    markDead: jest.fn(),
  };
  const registry = new OutboxHandlerRegistry();
  registry.register({ type: 'invoice.emit', handle });
  return {
    repo,
    relay: new OutboxRelay(
      repo,
      registry,
      new ConfigService({ outbox: config.get() }),
    ),
  };
}

describe('OutboxRelay', () => {
  it('records oldest due pending age in system scope', async () => {
    const { repo, relay } = setup([], jest.fn());
    const now = new Date('2026-10-13T12:00:00Z');
    repo.oldestPendingAvailableAt.mockImplementation(async () => {
      expect(getDatabaseScope()).toEqual({ system: 'outbox-relay' });
      return new Date(now.getTime() - 5000);
    });
    await relay.tick(now);
    expect(repo.oldestPendingAvailableAt).toHaveBeenCalledWith(now);
    expect(recordOutboxPendingAge).toHaveBeenCalledWith(5);
  });
  it('records zero pending age when nothing is due', async () => {
    const { relay } = setup([], jest.fn());
    await relay.tick();
    expect(recordOutboxPendingAge).toHaveBeenCalledWith(0);
  });
  it('claims in system scope and handles and completes in tenant scope', async () => {
    const handle = jest.fn(async () => {
      expect(getDatabaseScope()).toEqual({ tenantId, authUserId: undefined });
    });
    const { repo, relay } = setup([message()], handle);
    repo.claimBatch.mockImplementation(async () => {
      expect(getDatabaseScope()).toEqual({ system: 'outbox-relay' });
      return [message()];
    });
    repo.complete.mockImplementation(async () => {
      expect(getDatabaseScope()).toEqual({ tenantId, authUserId: undefined });
    });
    await relay.tick();
  });
  it('rejects missing settings explicitly and resets tick guard', async () => {
    const { repo } = setup([], jest.fn());
    const relay = new OutboxRelay(
      repo,
      new OutboxHandlerRegistry(),
      new ConfigService(),
    );
    await expect(relay.tick()).rejects.toThrow('Missing outbox configuration');
    await expect(relay.tick()).rejects.toThrow('Missing outbox configuration');
  });
  it('completes a message after its handler succeeds', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const { repo, relay } = setup([message()], handle);
    await relay.tick(new Date('2026-10-13T12:00:00Z'));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith(
      'm1',
      tenantId,
      expect.any(Date),
    );
    expect(repo.release).not.toHaveBeenCalled();
  });

  it('releases with backoff when the handler throws', async () => {
    const handle = jest.fn().mockRejectedValue(new Error('redis down'));
    const { repo, relay } = setup([message({ attempts: 1 })], handle);
    const now = new Date('2026-10-13T12:00:00Z');
    await relay.tick(now);
    expect(repo.release).toHaveBeenCalledWith(
      'm1',
      tenantId,
      'redis down',
      new Date(now.getTime() + 2000),
      expect.any(Date),
    );
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it('marks the message dead once maxAttempts is reached', async () => {
    const handle = jest.fn().mockRejectedValue(new Error('still down'));
    const { repo, relay } = setup([message({ attempts: 3 })], handle);
    await relay.tick(new Date());
    expect(repo.markDead).toHaveBeenCalledWith(
      'm1',
      tenantId,
      'still down',
      expect.any(Date),
    );
    expect(repo.release).not.toHaveBeenCalled();
  });

  it('releases a message of unknown type instead of dropping it', async () => {
    const { repo, relay } = setup(
      [message({ type: 'unknown.type' })],
      jest.fn(),
    );
    await relay.tick(new Date());
    expect(repo.release).toHaveBeenCalled();
  });

  it('a failing message does not stop the rest of the batch', async () => {
    const handle = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const { repo, relay } = setup(
      [message({ id: 'a' }), message({ id: 'b' })],
      handle,
    );
    await relay.tick(new Date());
    expect(repo.release).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith('b', tenantId, expect.any(Date));
  });

  it('ignores overlapping ticks', async () => {
    let finish: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const handle = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          if (entered) entered();
        }),
    );
    const { relay } = setup([message()], handle);
    const first = relay.tick(new Date());
    expect(await relay.tick(new Date())).toBe(0);
    await started;
    if (!finish) throw new Error('Handler did not start');
    finish();
    await first;
  });
});
