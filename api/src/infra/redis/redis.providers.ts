import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { QueueConfig } from '@/infra/config/configuration';
import { RedisCacheService } from './redis-cache.service';
import { CACHE_PORT, LOCK_PORT, REDIS_CLIENT } from './redis.constants';
import { RedisLockService } from './redis-lock.service';
import { RedisService } from './redis.service';
import { BullmqQueueService } from './bullmq-queue.service';
import { QueuePort } from './queue.port';
import { RedisRateLimiter } from '@/shared/http/redis-rate-limiter';

export const REDIS_RATE_LIMITER = 'REDIS_RATE_LIMITER';

export const redisProviders = [
  RedisService,
  RedisCacheService,
  RedisLockService,
  {
    provide: BullmqQueueService,
    useFactory: (
      config: ConfigService,
      email: Queue,
      emission: Queue,
      reconciliation: Queue,
      docPrep: Queue,
      nfseEmail: Queue,
      fiscalReconcile: Queue,
      metaCapi: Queue,
    ) =>
      new BullmqQueueService(
        {
          email,
          'nfse-emission': emission,
          'nfse-reconciliation': reconciliation,
          'nfse-doc-prep': docPrep,
          'nfse-email': nfseEmail,
          'nfse-fiscal-reconcile': fiscalReconcile,
          'meta-capi': metaCapi,
        },
        config.getOrThrow<QueueConfig>('queue'),
      ),
    inject: [
      ConfigService,
      getQueueToken('email'),
      getQueueToken('nfse-emission'),
      getQueueToken('nfse-reconciliation'),
      getQueueToken('nfse-doc-prep'),
      getQueueToken('nfse-email'),
      getQueueToken('nfse-fiscal-reconcile'),
      getQueueToken('meta-capi'),
    ],
  },
  { provide: QueuePort, useExisting: BullmqQueueService },
  {
    provide: REDIS_CLIENT,
    useFactory: (redisService: RedisService) => redisService.getClient(),
    inject: [RedisService],
  },
  { provide: CACHE_PORT, useExisting: RedisCacheService },
  { provide: LOCK_PORT, useExisting: RedisLockService },
  RedisRateLimiter,
  { provide: REDIS_RATE_LIMITER, useExisting: RedisRateLimiter },
];

export const redisExports = [
  BullModule,
  RedisService,
  RedisCacheService,
  RedisLockService,
  BullmqQueueService,
  QueuePort,
  REDIS_CLIENT,
  CACHE_PORT,
  LOCK_PORT,
  RedisRateLimiter,
  REDIS_RATE_LIMITER,
];
