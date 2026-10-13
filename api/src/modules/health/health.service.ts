import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import {
  AppConfig,
  MetaConfig,
  StorageConfig,
} from '@/infra/config/configuration';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import {
  checkMetaConfig,
  checkPostgres,
  checkRedis,
  checkStorageConfig,
  HealthCheck,
} from './health.readiness-checks';

export type HealthResponse = {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  checks?: Record<string, HealthCheck>;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  getLive(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  async getReady(): Promise<HealthResponse> {
    const checks = {
      postgres: await checkPostgres(this.dataSource),
      redis: await checkRedis(this.redis),
      meta: checkMetaConfig(this.configService.getOrThrow<MetaConfig>('meta')),
      storage: checkStorageConfig(
        this.configService.getOrThrow<AppConfig>('app'),
        this.configService.getOrThrow<StorageConfig>('storage'),
      ),
    };
    const status = Object.values(checks).every((check) => check.status === 'ok')
      ? 'ok'
      : 'degraded';

    return {
      ...this.getLive(),
      status,
      checks,
    };
  }
}
