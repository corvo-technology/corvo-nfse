import { EventEmitter } from 'node:events';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import {
  PostgresPoolTelemetryService,
  readPostgresPoolSnapshot,
} from './postgres-pool-telemetry.service';

describe('Postgres pool telemetry', () => {
  it('reports total, idle, busy and waiting connections', () => {
    const dataSource = {
      driver: {
        master: { totalCount: 10, idleCount: 3, waitingCount: 4 },
      },
    } as unknown as DataSource;

    expect(readPostgresPoolSnapshot(dataSource)).toEqual({
      total: 10,
      idle: 3,
      busy: 7,
      waiting: 4,
    });
  });

  it('ignores drivers that do not expose a pg-pool', () => {
    const dataSource = { driver: {} } as unknown as DataSource;
    expect(readPostgresPoolSnapshot(dataSource)).toBeNull();
  });

  it('prewarms the configured minimum and removes instrumentation on shutdown', async () => {
    const connect = jest.fn().mockResolvedValue({ release: jest.fn() });
    const pool = Object.assign(new EventEmitter(), {
      connect,
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      options: { max: 10 },
    });
    const dataSource = {
      driver: { master: pool },
    } as unknown as DataSource;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        applicationName: 'greenflow-api',
        pool: {
          max: 30,
          min: 2,
          idleTimeoutMs: 30_000,
          connectionTimeoutMs: 3_000,
          maxLifetimeSeconds: 1_800,
        },
        statementTimeoutMs: 0,
      }),
    } as unknown as ConfigService;
    const service = new PostgresPoolTelemetryService(dataSource, configService);

    await service.onApplicationBootstrap();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(pool.listenerCount('acquire')).toBe(1);
    expect(pool.listenerCount('release')).toBe(1);
    service.onApplicationShutdown();
    expect(pool.listenerCount('acquire')).toBe(0);
    expect(pool.listenerCount('release')).toBe(0);
  });
});
