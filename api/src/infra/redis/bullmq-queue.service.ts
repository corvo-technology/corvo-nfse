import { Queue } from 'bullmq';
import { QueueConfig } from '@/infra/config/configuration';
import {
  getJobStatus,
  removeRepeatable,
} from './bullmq-queue.service.commands';
import {
  addBulkJobs,
  addJob,
  scheduleJob,
} from './bullmq-queue.service.enqueue';
import { QueueName, QueuePort } from './queue.port';

type QueueRegistry = Record<QueueName, Queue>;

export class BullmqQueueService implements QueuePort {
  constructor(
    private readonly queues: QueueRegistry,
    readonly config: QueueConfig,
  ) {}

  add: QueuePort['add'] = (...args) => addJob(this, ...args);
  addBulk: QueuePort['addBulk'] = (...args) => addBulkJobs(this, ...args);
  schedule: QueuePort['schedule'] = (...args) => scheduleJob(this, ...args);
  removeRepeatable: QueuePort['removeRepeatable'] = (...args) =>
    removeRepeatable(this, ...args);
  getJobStatus: QueuePort['getJobStatus'] = (...args) =>
    getJobStatus(this, ...args);

  getQueue(queueName: QueueName): Queue {
    return this.queues[queueName];
  }
}
