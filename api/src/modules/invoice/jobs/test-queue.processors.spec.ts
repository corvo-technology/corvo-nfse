/* eslint-disable @typescript-eslint/no-unsafe-argument,@typescript-eslint/no-explicit-any,@typescript-eslint/no-require-imports */
import { MODULE_METADATA } from '@nestjs/common/constants';
import { SPLIT_QUEUE_NAMES } from '@/infra/redis/queue-routing';
import {
  ImportEmitProcessor,
  ImportEmitTestProcessor,
} from '@/modules/import/jobs/import-emit.processor';
import { NfseCancellationProcessor } from './nfse-cancellation.processor';
import { NfseDocPrepProcessor } from './nfse-doc-prep.processor';
import { NfseEmailProcessor } from './nfse-email.processor';
import { NfseEmissionProcessor } from './nfse-emission.processor';
import { NfseReconciliationProcessor } from './nfse-reconciliation.processor';
import {
  NfseCancellationTestProcessor,
  NfseDocPrepTestProcessor,
  NfseEmailTestProcessor,
  NfseEmissionTestProcessor,
  NfseReconciliationTestProcessor,
  TEST_QUEUE_PROCESSORS,
} from './test-queue.processors';

const PROCESSOR_METADATA = 'bullmq:processor_metadata';
const queueOf = (processor: object): string | undefined =>
  (
    Reflect.getMetadata(PROCESSOR_METADATA, processor) as
      { name?: string } | undefined
  )?.name;

describe('test queue processors', () => {
  it.each([
    [NfseEmissionProcessor, NfseEmissionTestProcessor, 'nfse-emission'],
    [
      NfseReconciliationProcessor,
      NfseReconciliationTestProcessor,
      'nfse-reconciliation',
    ],
    [
      NfseCancellationProcessor,
      NfseCancellationTestProcessor,
      'nfse-cancellation',
    ],
    [NfseDocPrepProcessor, NfseDocPrepTestProcessor, 'nfse-doc-prep'],
    [NfseEmailProcessor, NfseEmailTestProcessor, 'nfse-email'],
  ] as const)(
    '%p keeps its queue and its twin listens on the -test queue',
    (base, twin, name) => {
      expect(queueOf(base)).toBe(name);
      expect(queueOf(twin)).toBe(`${name}-test`);
      expect(Object.getPrototypeOf(twin)).toBe(base);
    },
  );

  it('the worker runs exactly one processor for every live queue and test twin', () => {
    const { WorkerAppModule } = require('@/worker-app.module');
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      WorkerAppModule,
    ) as object[];
    const listened = providers
      .map(queueOf)
      .filter((name): name is string => Boolean(name));
    for (const name of SPLIT_QUEUE_NAMES)
      expect(listened.filter((n) => n === name)).toHaveLength(1);
    expect(TEST_QUEUE_PROCESSORS.every((p) => providers.includes(p))).toBe(
      true,
    );
  });

  it('import-emit has a twin too', () => {
    expect(queueOf(ImportEmitProcessor)).toBe('import-emit');
    expect(queueOf(ImportEmitTestProcessor)).toBe('import-emit-test');
  });
});

describe('test queue concurrency', () => {
  const withWorker = <T extends object>(processor: T) => {
    const worker = { concurrency: 1 };
    Object.defineProperty(processor, 'worker', { get: () => worker });
    return worker;
  };
  const config = {
    get: () => ({ nfseEmissionConcurrency: 3, testQueueConcurrency: 2 }),
  };

  it('the live emission queue keeps NFSE_EMISSION_CONCURRENCY and the twin uses TEST_QUEUE_CONCURRENCY', () => {
    const live = new NfseEmissionProcessor({} as any, {} as any, config as any);
    const liveWorker = withWorker(live);
    live.onApplicationBootstrap();
    expect(liveWorker.concurrency).toBe(3);

    const test = new NfseEmissionTestProcessor(
      {} as any,
      {} as any,
      config as any,
    );
    const testWorker = withWorker(test);
    test.onApplicationBootstrap();
    expect(testWorker.concurrency).toBe(2);
  });

  it.each([
    NfseReconciliationTestProcessor,
    NfseCancellationTestProcessor,
    NfseDocPrepTestProcessor,
    NfseEmailTestProcessor,
  ])('%p runs TEST_QUEUE_CONCURRENCY jobs at once', (Twin) => {
    const twin = Object.create(Twin.prototype) as InstanceType<typeof Twin>;
    Object.assign(twin, { appConfig: config });
    const worker = withWorker(twin);
    twin.onApplicationBootstrap();
    expect(worker.concurrency).toBe(2);
  });
});

describe('deploy transition', () => {
  it('the live processors still finish a test job that was already waiting in the old shared queue', async () => {
    const workflow = { process: jest.fn().mockResolvedValue(undefined) };
    const locks = {
      acquire: jest.fn().mockResolvedValue({}),
      release: jest.fn(),
    };
    const processor = new NfseEmissionProcessor(locks as any, workflow as any);
    // A test invoice's job, added before the split: it carries no environment, the processor
    // does not filter on one, so whichever queue it sits in gets it processed.
    const job = {
      data: { invoiceId: 'old-test-invoice', tenantId: 't', companyId: 'c' },
      opts: {},
      updateData: jest.fn(),
    };
    await processor.process(job as any, 'token');
    expect(workflow.process).toHaveBeenCalledWith(job.data);
  });
});
