import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import {
  AppConfig,
  MetaConfig,
  StorageConfig,
  WhatsAppConfig,
} from '@/infra/config/configuration';

export type HealthCheck = {
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
};

export async function checkPostgres(
  dataSource: DataSource,
): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    await dataSource.query('select 1');
    return okCheck(startedAt);
  } catch (error) {
    return errorCheck(startedAt, error);
  }
}

export async function checkRedis(redis: Redis): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    await redis.ping();
    return okCheck(startedAt);
  } catch (error) {
    return errorCheck(startedAt, error);
  }
}

export function checkRequiredConfig(
  label: string,
  values: Record<string, unknown>,
): HealthCheck {
  const missing = Object.entries(values)
    .filter(
      ([, value]) => value === undefined || value === null || value === '',
    )
    .map(([key]) => key);

  return missing.length === 0
    ? { status: 'ok' }
    : {
        status: 'error',
        error: `${label} missing required config: ${missing.join(', ')}`,
      };
}

export function checkWhatsAppConfig(config: WhatsAppConfig): HealthCheck {
  return checkRequiredConfig('whatsapp', {
    webhookVerifyToken: config.webhookVerifyToken,
  });
}

export function checkMetaConfig(config: MetaConfig): HealthCheck {
  return checkRequiredConfig('meta', {
    graphApiBaseUrl: config.graphApiBaseUrl,
    graphApiVersion: config.graphApiVersion,
    secretsEncryptionKey: config.secretsEncryptionKey,
  });
}

export function checkStorageConfig(
  app: AppConfig,
  config: StorageConfig,
): HealthCheck {
  if (app.nodeEnv === 'production' && config.provider !== 's3') {
    return {
      status: 'error',
      error: 'storage requires STORAGE_PROVIDER=s3 in production',
    };
  }

  if (config.provider === 'unavailable') {
    return { status: 'ok' };
  }

  return checkRequiredConfig('storage', {
    provider: config.provider,
    s3Endpoint: config.s3Endpoint,
    s3Region: config.s3Region,
    s3AccessKeyId: config.s3AccessKeyId,
    s3SecretAccessKey: config.s3SecretAccessKey,
  });
}

function okCheck(startedAt: number): HealthCheck {
  return {
    status: 'ok',
    latencyMs: elapsedMs(startedAt),
  };
}

function errorCheck(startedAt: number, error: unknown): HealthCheck {
  return {
    status: 'error',
    latencyMs: elapsedMs(startedAt),
    error: normalizeError(error),
  };
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown health check error';
}
