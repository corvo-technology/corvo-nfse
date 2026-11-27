import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { QueueConfig } from '@/infra/config/configuration.types';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { LockPort } from '@/infra/redis/lock.port';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import {
  NfseWorkflowService,
  type FiscalJobData,
} from '../application/nfse-workflow.service';
import { runOrWaitForPortal } from './portal-wait';

export type NfseEmissionJobData = FiscalJobData;

@Processor('nfse-emission')
@Injectable()
export class NfseEmissionProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    private readonly workflow: NfseWorkflowService,
    @Optional() private readonly config?: ConfigService,
  ) {
    super();
  }

  /**
   * Several invoices go to the portal at once (`NFSE_EMISSION_CONCURRENCY`, default 3). Safe because
   * the DPS number is reserved atomically and the per-invoice lock keeps one invoice in one worker slot.
   */
  onApplicationBootstrap(): void {
    const concurrency = this.concurrencyFrom(
      this.config?.get<QueueConfig>('queue'),
    );
    if (concurrency) this.worker.concurrency = concurrency;
  }

  /** The test twin (test-queue.processors.ts) overrides this with its own, lower number. */
  protected concurrencyFrom(queue?: QueueConfig): number | undefined {
    return queue?.nfseEmissionConcurrency;
  }

  async process(job: Job<NfseEmissionJobData>, token?: string): Promise<void> {
    await runOrWaitForPortal(job, token, async () => {
      // The same lock protects emission and reconciliation for this invoice.
      const lock = await this.locks.acquire(
        `nfse:invoice:${job.data.invoiceId}`,
        { ttlMs: 300000 },
      );
      if (!lock) throw new Error('Invoice is already being processed');
      try {
        await this.workflow.process(job.data);
      } finally {
        await this.locks.release(lock);
      }
    });
  }

  /** Fires on every failed attempt; only the last one is surfaced on the invoice. */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<NfseEmissionJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await this.workflow.handleEmissionExhausted(job.data, error);
  }
}
