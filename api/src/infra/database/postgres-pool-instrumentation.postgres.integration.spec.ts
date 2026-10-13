/* eslint-disable @typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { instrumentPostgresPool } from './postgres-pool-instrumentation';

const databaseUrl =
  process.env.POSTGRES_POOL_TEST_DATABASE_URL ??
  process.env.AGENT_RUNTIME_TEST_DATABASE_URL ??
  (process.env.RUN_POSTGRES_POOL_TESTS === '1'
    ? process.env.DATABASE_URL
    : undefined);
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('PostgreSQL pool telemetry integration', () => {
  it('observes a real queued acquisition and both connection releases', async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const observer = { waitTime: jest.fn(), useTime: jest.fn() };
    const dispose = instrumentPostgresPool(
      pool,
      { poolName: 'integration.pool', runtimeRole: 'worker' },
      observer,
    );

    try {
      const held = await pool.connect();
      const queuedConnection = pool.connect();
      await waitFor(() => pool.waitingCount === 1);
      expect(pool.waitingCount).toBe(1);

      held.release();
      const queued = await queuedConnection;
      queued.release();
      await waitFor(() => observer.useTime.mock.calls.length === 2);

      expect(observer.waitTime).toHaveBeenCalledTimes(2);
      expect(
        Math.max(...observer.waitTime.mock.calls.map(([seconds]) => seconds)),
      ).toBeGreaterThan(0);
      expect(observer.useTime).toHaveBeenCalledTimes(2);
      expect(pool.waitingCount).toBe(0);
    } finally {
      dispose();
      await pool.end();
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for pool');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
