import { buildJobOptions } from './bullmq-queue.helpers';
import { BullmqQueueService } from './bullmq-queue.service';
import { toJobRef } from './bullmq-queue.service.commands';
import { publishQueueJobWithTrace } from './queue-trace-context';
import {
  BulkQueueJob,
  EnqueueOptions,
  QueueJobPayload,
  QueueJobRef,
  QueueName,
  ScheduledQueueJob,
} from './queue.port';

export async function addJob(
  service: BullmqQueueService,
  queueName: QueueName,
  jobName: string,
  payload: QueueJobPayload,
  options: EnqueueOptions = {},
): Promise<QueueJobRef> {
  const job = await publishQueueJobWithTrace(
    queueName,
    jobName,
    payload,
    (tracedPayload) =>
      service
        .getQueue(queueName)
        .add(jobName, tracedPayload, buildJobOptions(service.config, options)),
  );

  return toJobRef(queueName, jobName, job);
}

export function addBulkJobs(
  service: BullmqQueueService,
  jobs: BulkQueueJob[],
): Promise<QueueJobRef[]> {
  return Promise.all(
    jobs.map((job) =>
      addJob(service, job.queueName, job.jobName, job.payload, job.options),
    ),
  );
}

export async function scheduleJob(
  service: BullmqQueueService,
  job: ScheduledQueueJob,
): Promise<QueueJobRef> {
  const scheduled = await publishQueueJobWithTrace(
    job.queueName,
    job.jobName,
    job.payload,
    (tracedPayload) =>
      service.getQueue(job.queueName).add(job.jobName, tracedPayload, {
        ...buildJobOptions(service.config, job.options),
        repeat: { pattern: job.repeatPattern },
      }),
  );

  return toJobRef(job.queueName, job.jobName, scheduled);
}
