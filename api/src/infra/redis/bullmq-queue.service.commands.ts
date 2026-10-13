import { Job } from 'bullmq';
import { normalizeJobStatus } from './bullmq-queue.helpers';
import { BullmqQueueService } from './bullmq-queue.service';
import { QueueJobRef, QueueJobStatus, QueueName } from './queue.port';

export async function removeRepeatable(
  service: BullmqQueueService,
  queueName: QueueName,
  jobName: string,
  repeatPattern: string,
): Promise<boolean> {
  return service.getQueue(queueName).removeRepeatable(jobName, {
    pattern: repeatPattern,
  });
}

export async function getJobStatus(
  service: BullmqQueueService,
  queueName: QueueName,
  jobId: string,
): Promise<QueueJobStatus> {
  const job = await service.getQueue(queueName).getJob(jobId);

  if (job === undefined || job === null) {
    return null;
  }

  return normalizeJobStatus(await job.getState());
}

export function toJobRef(
  queueName: QueueName,
  jobName: string,
  job: Job,
): QueueJobRef {
  return {
    id: String(job.id),
    queueName,
    jobName,
  };
}
