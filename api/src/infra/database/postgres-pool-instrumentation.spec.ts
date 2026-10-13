import { EventEmitter } from 'node:events';
import type { PoolClient } from 'pg';
import {
  instrumentPostgresPool,
  resolveCorvoRuntimeRole,
  type InstrumentablePostgresPool,
} from './postgres-pool-instrumentation';

class FakePool extends EventEmitter {
  totalCount = 1;
  idleCount = 0;
  waitingCount = 0;
  options = { max: 4 };
  readonly client = {} as PoolClient;

  connect(
    callback?: (
      error: Error | undefined,
      client: PoolClient | undefined,
      release: (error?: unknown) => void,
    ) => void,
  ): Promise<PoolClient> | void {
    this.emit('acquire', this.client);
    const release = (error?: unknown) =>
      this.emit('release', error, this.client);
    if (callback) {
      callback(undefined, this.client, release);
      return;
    }
    return Promise.resolve(this.client);
  }
}

describe('PostgreSQL pool instrumentation', () => {
  it('records promise acquisition and connection use with stable attributes', async () => {
    const pool = new FakePool();
    const observer = { waitTime: jest.fn(), useTime: jest.fn() };
    const dispose = instrumentPostgresPool(
      pool as unknown as InstrumentablePostgresPool,
      { poolName: 'typeorm.main', runtimeRole: 'worker' },
      observer,
    );

    const client = await pool.connect();
    pool.emit('release', undefined, client);

    expect(observer.waitTime).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'db.client.connection.pool.name': 'typeorm.main',
        'corvo.runtime.role': 'worker',
      }),
    );
    expect(observer.useTime).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Object),
    );
    dispose();
    expect(pool.listenerCount('acquire')).toBe(0);
    expect(pool.listenerCount('release')).toBe(0);
  });

  it('supports callback acquisition and returns the same disposer on duplicate registration', async () => {
    const pool = new FakePool();
    const observer = { waitTime: jest.fn(), useTime: jest.fn() };
    const instrumentable = pool as unknown as InstrumentablePostgresPool;
    const first = instrumentPostgresPool(
      instrumentable,
      { poolName: 'langgraph.checkpoint' },
      observer,
    );
    const second = instrumentPostgresPool(
      instrumentable,
      { poolName: 'ignored-duplicate' },
      observer,
    );

    expect(second).toBe(first);
    await new Promise<void>((resolve, reject) => {
      pool.connect((error, client, release) => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        if (error || !client) return reject(error);
        release();
        resolve();
      });
    });

    expect(observer.waitTime).toHaveBeenCalledTimes(1);
    expect(observer.useTime).toHaveBeenCalledTimes(1);
    first();
  });

  it('infers runtime roles from production entrypoints', () => {
    expect(resolveCorvoRuntimeRole('/app/dist/main.worker.js')).toBe('worker');
    expect(resolveCorvoRuntimeRole('/app/dist/main.js')).toBe('api');
    expect(resolveCorvoRuntimeRole('/app/dist/main.webhooks.js')).toBe('api');
  });
});
