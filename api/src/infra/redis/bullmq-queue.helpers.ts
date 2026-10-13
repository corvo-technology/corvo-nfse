import { JobsOptions } from 'bullmq';
import { QueueConfig } from '@/infra/config/configuration';
import { EnqueueOptions, QueueJobStatus } from './queue.port';

export function buildJobOptions(
  config: QueueConfig,
  options: EnqueueOptions = {},
): JobsOptions {
  const attempts = options.attempts ?? config.defaultAttempts;
  const backoffMs = options.backoffMs ?? config.defaultBackoffMs;

  assertPositiveInteger(attempts, 'attempts');
  assertPositiveInteger(backoffMs, 'backoffMs');

  return {
    attempts,
    backoff: { type: 'exponential', delay: backoffMs },
    delay: options.delayMs,
    jobId: sanitizeBullmqJobId(options.idempotencyKey),
    removeOnComplete: options.removeOnComplete ?? true,
    removeOnFail: options.removeOnFail ?? 1000,
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
  };
}

export function normalizeJobStatus(status: string): QueueJobStatus {
  if (
    [
      'completed',
      'failed',
      'delayed',
      'active',
      'waiting',
      'waiting-children',
      'prioritized',
    ].includes(status)
  ) {
    return status as QueueJobStatus;
  }

  return 'unknown';
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function sanitizeBullmqJobId(idempotencyKey?: string): string | undefined {
  return idempotencyKey?.replace(/:/g, '_');
}
