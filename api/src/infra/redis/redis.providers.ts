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
import { SPLIT_QUEUE_NAMES } from './queue-routing';
import { RedisRateLimiter } from '@/shared/http/redis-rate-limiter';

export const REDIS_RATE_LIMITER = 'REDIS_RATE_LIMITER';

/** Queues the shared BullmqQueueService can add to: every split queue with its test twin, plus the unsplit ones. */
export const REGISTERED_QUEUE_NAMES: string[] = [
  'email',
  'nfse-fiscal-reconcile',
  ...SPLIT_QUEUE_NAMES,
];

export const redisProviders = [
  RedisService,
  RedisCacheService,
  RedisLockService,
  {
    provide: BullmqQueueService,
    useFactory: (config: ConfigService, ...queues: Queue[]) =>
      new BullmqQueueService(
        Object.fromEntries(
          REGISTERED_QUEUE_NAMES.map((name, index) => [name, queues[index]]),
        ),
        config.getOrThrow<QueueConfig>('queue'),
      ),
    inject: [
      ConfigService,
      ...REGISTERED_QUEUE_NAMES.map((name) => getQueueToken(name)),
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
