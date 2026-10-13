import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { DatabaseConfig } from '@/infra/config/configuration';
import {
  instrumentPostgresPool,
  type InstrumentablePostgresPool,
  readPoolSnapshot,
} from './postgres-pool-instrumentation';

type PgPoolLike = {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
};

export type PostgresPoolSnapshot = {
  total: number;
  idle: number;
  busy: number;
  waiting: number;
};

@Injectable()
export class PostgresPoolTelemetryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PostgresPoolTelemetryService.name);

  private disposeInstrumentation?: () => void;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const database = this.configService.getOrThrow<DatabaseConfig>('database');
    const pool = postgresPoolFromDataSource(this.dataSource);
    if (pool) {
      this.disposeInstrumentation = instrumentPostgresPool(pool, {
        poolName: 'typeorm.main',
        max: database.pool.max,
      });
      await warmPool(pool, database.pool.min);
    }
    this.logger.log({
      event: 'postgres_pool_configured',
      applicationName: database.applicationName,
      max: database.pool.max,
      min: database.pool.min,
      idleTimeoutMs: database.pool.idleTimeoutMs,
      connectionTimeoutMs: database.pool.connectionTimeoutMs,
      maxLifetimeSeconds: database.pool.maxLifetimeSeconds,
      statementTimeoutMs: database.statementTimeoutMs,
    });
  }

  onApplicationShutdown(): void {
    this.disposeInstrumentation?.();
    this.disposeInstrumentation = undefined;
  }
}

async function warmPool(
  pool: InstrumentablePostgresPool,
  minimumConnections: number,
): Promise<void> {
  const clients = await Promise.all(
    Array.from({ length: minimumConnections }, () => pool.connect()),
  );
  for (const client of clients) client.release();
}

export function readPostgresPoolSnapshot(
  dataSource: Pick<DataSource, 'driver'>,
): PostgresPoolSnapshot | null {
  const driver = dataSource.driver as unknown as { master?: unknown };
  if (!isPgPoolLike(driver.master)) return null;
  return readPoolSnapshot(driver.master);
}

function postgresPoolFromDataSource(
  dataSource: Pick<DataSource, 'driver'>,
): InstrumentablePostgresPool | null {
  const driver = dataSource.driver as unknown as { master?: unknown };
  return isInstrumentablePgPool(driver.master) ? driver.master : null;
}

function isPgPoolLike(value: unknown): value is PgPoolLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PgPoolLike>;
  return (
    typeof candidate.totalCount === 'number' &&
    typeof candidate.idleCount === 'number' &&
    typeof candidate.waitingCount === 'number'
  );
}

function isInstrumentablePgPool(
  value: unknown,
): value is InstrumentablePostgresPool {
  return (
    isPgPoolLike(value) &&
    typeof (value as Partial<InstrumentablePostgresPool>).connect ===
      'function' &&
    typeof (value as Partial<InstrumentablePostgresPool>).on === 'function' &&
    typeof (value as Partial<InstrumentablePostgresPool>).removeListener ===
      'function'
  );
}
