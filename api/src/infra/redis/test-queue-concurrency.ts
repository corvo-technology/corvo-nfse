import type { ConfigService } from '@nestjs/config';
import type { Worker } from 'bullmq';
import type { QueueConfig } from '@/infra/config/configuration.types';

/** One limit (`TEST_QUEUE_CONCURRENCY`) for every test twin; the worker exists once the app has started. */
export function applyTestConcurrency(
  worker: Worker,
  config?: ConfigService,
): void {
  const concurrency = config?.get<QueueConfig>('queue')?.testQueueConcurrency;
  if (concurrency) worker.concurrency = concurrency;
}
