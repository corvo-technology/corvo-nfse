/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-argument */
import { metrics, type Attributes } from '@opentelemetry/api';
import type { Pool, PoolClient } from 'pg';
import {
  durationHistogramOptions,
  POSTGRES_POOL_DURATION_BOUNDARIES_SECONDS,
} from '@/shared/observability/duration-histogram';

type PoolConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  release: (error?: unknown) => void,
) => void;

export type InstrumentablePostgresPool = Pick<
  Pool,
  | 'connect'
  | 'idleCount'
  | 'on'
  | 'removeListener'
  | 'totalCount'
  | 'waitingCount'
> & {
  options?: { max?: number };
};

export type PostgresPoolInstrumentationOptions = {
  poolName: string;
  max?: number;
  runtimeRole?: string;
};

export type PostgresPoolInstrumentationObserver = {
  waitTime?(seconds: number, attributes: Attributes): void;
  useTime?(seconds: number, attributes: Attributes): void;
};

type InstrumentedPool = {
  attributes: Attributes;
  max: number;
  pool: InstrumentablePostgresPool;
};

const meter = metrics.getMeter('corvo.postgres.pool');
const connectionGauge = meter.createObservableGauge(
  'corvo.postgres.pool.connections',
  {
    description: 'PostgreSQL application pool connections',
    unit: '{connection}',
  },
);
const waitingGauge = meter.createObservableGauge(
  'corvo.postgres.pool.waiting',
  {
    description: 'Requests currently waiting for a PostgreSQL pool connection',
    unit: '{request}',
  },
);
const maxGauge = meter.createObservableGauge('corvo.postgres.pool.max', {
  description: 'Maximum number of open connections allowed for the pool',
  unit: '{connection}',
});
const waitTimeHistogram = meter.createHistogram(
  'db.client.connection.wait_time',
  durationHistogramOptions(
    'Time spent obtaining an open connection from the pool',
    POSTGRES_POOL_DURATION_BOUNDARIES_SECONDS,
  ),
);
const useTimeHistogram = meter.createHistogram(
  'db.client.connection.use_time',
  durationHistogramOptions(
    'Time between borrowing and returning a pool connection',
    POSTGRES_POOL_DURATION_BOUNDARIES_SECONDS,
  ),
);

const instrumentedPools = new Map<object, InstrumentedPool>();
const disposers = new WeakMap<object, () => void>();

connectionGauge.addCallback((result) => {
  for (const { attributes, pool } of instrumentedPools.values()) {
    const snapshot = readPoolSnapshot(pool);
    result.observe(snapshot.total, { ...attributes, state: 'total' });
    result.observe(snapshot.idle, { ...attributes, state: 'idle' });
    result.observe(snapshot.busy, { ...attributes, state: 'busy' });
  }
});

waitingGauge.addCallback((result) => {
  for (const { attributes, pool } of instrumentedPools.values()) {
    result.observe(pool.waitingCount, attributes);
  }
});

maxGauge.addCallback((result) => {
  for (const { attributes, max } of instrumentedPools.values()) {
    result.observe(max, attributes);
  }
});

export function instrumentPostgresPool(
  pool: InstrumentablePostgresPool,
  options: PostgresPoolInstrumentationOptions,
  observer: PostgresPoolInstrumentationObserver = {},
): () => void {
  const existing = disposers.get(pool);
  if (existing) return existing;

  const attributes: Attributes = {
    'db.client.connection.pool.name': options.poolName,
    'corvo.runtime.role': options.runtimeRole ?? resolveCorvoRuntimeRole(),
  };
  const max = normalizePoolMax(options.max ?? pool.options?.max);
  const acquiredAt = new WeakMap<object, number>();

  const originalConnect = pool.connect.bind(pool);

  function recordWait(startedAt: number): void {
    const seconds = elapsedSeconds(startedAt);
    waitTimeHistogram.record(seconds, attributes);
    observer.waitTime?.(seconds, attributes);
  }

  const wrappedConnect = function (
    callback?: PoolConnectCallback,
  ): Promise<PoolClient> | void {
    const startedAt = performance.now();
    if (callback) {
      return originalConnect((error, client, release) => {
        if (!error && client) recordWait(startedAt);

        callback(error, client, release);
      });
    }

    return originalConnect().then((client) => {
      recordWait(startedAt);
      return client;
    });
  } as InstrumentablePostgresPool['connect'];

  const onAcquire = (client: PoolClient) => {
    acquiredAt.set(client, performance.now());
  };
  const onRelease = (_error: Error | undefined, client: PoolClient) => {
    const startedAt = acquiredAt.get(client);
    acquiredAt.delete(client);
    if (startedAt === undefined) return;
    const seconds = elapsedSeconds(startedAt);
    useTimeHistogram.record(seconds, attributes);
    observer.useTime?.(seconds, attributes);
  };
  const onRemove = (client: PoolClient) => acquiredAt.delete(client);

  pool.connect = wrappedConnect;
  pool.on('acquire', onAcquire);
  pool.on('release', onRelease);
  pool.on('remove', onRemove);
  instrumentedPools.set(pool, { attributes, max, pool });

  const dispose = () => {
    if (pool.connect === wrappedConnect) {
      pool.connect = originalConnect;
    }
    pool.removeListener('acquire', onAcquire);
    pool.removeListener('release', onRelease);
    pool.removeListener('remove', onRemove);
    instrumentedPools.delete(pool);
    disposers.delete(pool);
  };
  disposers.set(pool, dispose);
  return dispose;
}

export function readPoolSnapshot(pool: {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}): { total: number; idle: number; busy: number; waiting: number } {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    busy: Math.max(pool.totalCount - pool.idleCount, 0),
    waiting: pool.waitingCount,
  };
}

export function resolveCorvoRuntimeRole(
  argvEntry = process.argv[1] ?? '',
  configured = process.env.CORVO_RUNTIME_ROLE,
): string {
  if (configured?.trim()) return configured.trim();
  if (argvEntry.includes('main.worker')) return 'worker';
  return 'api';
}

function normalizePoolMax(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : 10;
}

function elapsedSeconds(startedAt: number): number {
  return Math.max(performance.now() - startedAt, 0) / 1000;
}
