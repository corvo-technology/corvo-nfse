import { Queue } from 'bullmq';
import { BullmqQueueService } from './bullmq-queue.service';

const MOCK_QUEUE_NAMES = [
  'dashboard.notifications',
  'billing.webhook_reconcile',
] as const;

describe('BullmqQueueService', () => {
  function createQueueMock() {
    return {
      add: jest.fn(),
      getJob: jest.fn(),
      removeRepeatable: jest.fn(),
    };
  }

  function createService(queue = createQueueMock()) {
    const queues = MOCK_QUEUE_NAMES.reduce(
      (acc, name) => ({
        ...acc,
        [name]: queue as unknown as Queue,
      }),
      {} as Record<(typeof MOCK_QUEUE_NAMES)[number], Queue>,
    );

    return {
      service: new BullmqQueueService(queues, {
        defaultAttempts: 3,
        defaultBackoffMs: 5000,
      }),
      queue,
    };
  }

  it('adds a job with default attempts and backoff', async () => {
    const { service, queue } = createService();
    queue.add.mockResolvedValue({ id: 'job-1' });

    await expect(
      service.add('dashboard.notifications', 'notification', {
        type: 'test',
      }),
    ).resolves.toEqual({
      id: 'job-1',
      queueName: 'dashboard.notifications',
      jobName: 'notification',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'notification',
      { type: 'test' },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        delay: undefined,
        jobId: undefined,
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  });

  it('uses idempotencyKey as BullMQ jobId', async () => {
    const { service, queue } = createService();
    queue.add.mockResolvedValue({ id: 'dedup-1' });

    await service.add(
      'billing.webhook_reconcile',
      'billing.webhook_reconcile',
      { event: 'OPENPIX:CHARGE_COMPLETED' },
      { idempotencyKey: 'dedup-1', attempts: 5, backoffMs: 1000 },
    );

    expect(queue.add).toHaveBeenCalledWith(
      'billing.webhook_reconcile',
      { event: 'OPENPIX:CHARGE_COMPLETED' },
      expect.objectContaining({
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        jobId: 'dedup-1',
      }),
    );
  });

  it('sanitizes idempotencyKey before using it as BullMQ jobId', async () => {
    const { service, queue } = createService();
    queue.add.mockResolvedValue({ id: 'billing-webhook_evt-1' });

    await service.add(
      'billing.webhook_reconcile',
      'billing.webhook_reconcile',
      { event: 'OPENPIX:CHARGE_COMPLETED' },
      { idempotencyKey: 'billing-webhook:evt-1' },
    );

    expect(queue.add).toHaveBeenCalledWith(
      'billing.webhook_reconcile',
      { event: 'OPENPIX:CHARGE_COMPLETED' },
      expect.objectContaining({
        jobId: 'billing-webhook_evt-1',
      }),
    );
  });

  it('schedules repeatable jobs', async () => {
    const { service, queue } = createService();
    queue.add.mockResolvedValue({ id: 'repeat-1' });

    await expect(
      service.schedule({
        queueName: 'billing.webhook_reconcile',
        jobName: 'billing.webhook_reconcile',
        payload: {},
        repeatPattern: '*/5 * * * *',
      }),
    ).resolves.toEqual({
      id: 'repeat-1',
      queueName: 'billing.webhook_reconcile',
      jobName: 'billing.webhook_reconcile',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'billing.webhook_reconcile',
      {},
      expect.objectContaining({
        repeat: {
          pattern: '*/5 * * * *',
        },
      }),
    );
  });

  it('removes repeatable jobs', async () => {
    const { service, queue } = createService();
    queue.removeRepeatable.mockResolvedValue(true);

    await expect(
      service.removeRepeatable(
        'billing.webhook_reconcile',
        'billing.webhook_reconcile',
        '*/5 * * * *',
      ),
    ).resolves.toBe(true);
  });

  it('returns null when a job is not found', async () => {
    const { service, queue } = createService();
    queue.getJob.mockResolvedValue(undefined);

    await expect(
      service.getJobStatus('dashboard.notifications', 'job-1'),
    ).resolves.toBeNull();
  });

  it('returns known job status', async () => {
    const { service, queue } = createService();
    queue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
    });

    await expect(
      service.getJobStatus('dashboard.notifications', 'job-1'),
    ).resolves.toBe('completed');
  });
});
