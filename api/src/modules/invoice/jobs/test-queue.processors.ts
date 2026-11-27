import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import type { QueueConfig } from '@/infra/config/configuration.types';
import { testTwinOf } from '@/infra/redis/queue-routing';
import { applyTestConcurrency } from '@/infra/redis/test-queue-concurrency';
import { NfseCancellationProcessor } from './nfse-cancellation.processor';
import { NfseDocPrepProcessor } from './nfse-doc-prep.processor';
import { NfseEmailProcessor } from './nfse-email.processor';
import { NfseEmissionProcessor } from './nfse-emission.processor';
import { NfseReconciliationProcessor } from './nfse-reconciliation.processor';

/**
 * Test (homologação) twins of the invoice processors. Same code, different queue: each one is
 * a subclass listening on `<queue>-test` (see queue-routing.ts), so a flood of test notes only
 * fills these queues and the live workers stay free. The concurrency of every twin comes from
 * one number, `TEST_QUEUE_CONCURRENCY`.
 *
 * Deploy transition: the base processors stay as they are and keep serving the old shared
 * queues, including test jobs that were already waiting there when this was deployed.
 */

@Processor(testTwinOf('nfse-emission'))
@Injectable()
export class NfseEmissionTestProcessor extends NfseEmissionProcessor {
  protected override concurrencyFrom(queue?: QueueConfig): number | undefined {
    return queue?.testQueueConcurrency;
  }
}

@Processor(testTwinOf('nfse-reconciliation'))
@Injectable()
export class NfseReconciliationTestProcessor
  extends NfseReconciliationProcessor
  implements OnApplicationBootstrap
{
  @Inject(ConfigService) private readonly appConfig?: ConfigService;
  onApplicationBootstrap(): void {
    applyTestConcurrency(this.worker, this.appConfig);
  }
}

@Processor(testTwinOf('nfse-cancellation'))
@Injectable()
export class NfseCancellationTestProcessor
  extends NfseCancellationProcessor
  implements OnApplicationBootstrap
{
  @Inject(ConfigService) private readonly appConfig?: ConfigService;
  onApplicationBootstrap(): void {
    applyTestConcurrency(this.worker, this.appConfig);
  }
}

@Processor(testTwinOf('nfse-doc-prep'))
@Injectable()
export class NfseDocPrepTestProcessor
  extends NfseDocPrepProcessor
  implements OnApplicationBootstrap
{
  @Inject(ConfigService) private readonly appConfig?: ConfigService;
  onApplicationBootstrap(): void {
    applyTestConcurrency(this.worker, this.appConfig);
  }
}

@Processor(testTwinOf('nfse-email'))
@Injectable()
export class NfseEmailTestProcessor
  extends NfseEmailProcessor
  implements OnApplicationBootstrap
{
  @Inject(ConfigService) private readonly appConfig?: ConfigService;
  onApplicationBootstrap(): void {
    applyTestConcurrency(this.worker, this.appConfig);
  }
}

export const TEST_QUEUE_PROCESSORS = [
  NfseEmissionTestProcessor,
  NfseReconciliationTestProcessor,
  NfseCancellationTestProcessor,
  NfseDocPrepTestProcessor,
  NfseEmailTestProcessor,
];
