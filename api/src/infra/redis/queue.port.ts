export type QueueName = string;

export type QueueJobPayload = Record<string, unknown>;

export type QueueJobRef = {
  id: string;
  queueName: QueueName;
  jobName: string;
};

export type QueueJobStatus =
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'active'
  | 'waiting'
  | 'waiting-children'
  | 'prioritized'
  | 'unknown'
  | null;

export type QueueJobTelemetry = {
  traceContext?: Record<string, string>;
};

export type EnqueueOptions = {
  attempts?: number;
  backoffMs?: number;
  delayMs?: number;
  idempotencyKey?: string;
  removeOnComplete?: boolean;
  removeOnFail?: number | boolean;
  priority?: number;
  jobId?: string;
};

export type BulkQueueJob = {
  queueName: QueueName;
  jobName: string;
  payload: QueueJobPayload;
  options?: EnqueueOptions;
};

export type ScheduledQueueJob = {
  queueName: QueueName;
  jobName: string;
  payload: QueueJobPayload;
  repeatPattern: string;
  options?: EnqueueOptions;
};

export abstract class QueuePort {
  abstract add(
    queueName: QueueName,
    jobName: string,
    payload: QueueJobPayload,
    options?: EnqueueOptions,
  ): Promise<QueueJobRef>;
  abstract addBulk(jobs: BulkQueueJob[]): Promise<QueueJobRef[]>;
  abstract schedule(job: ScheduledQueueJob): Promise<QueueJobRef>;
  abstract removeRepeatable(
    queueName: QueueName,
    jobName: string,
    repeatPattern: string,
  ): Promise<boolean>;
  abstract getJobStatus(
    queueName: QueueName,
    jobId: string,
  ): Promise<QueueJobStatus>;
}
