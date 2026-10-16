import { Inject, Injectable } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { LockPort } from '@/infra/redis/lock.port';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import {
  NfseWorkflowService,
  type FiscalJobData,
} from '../application/nfse-workflow.service';

export type NfseEmissionJobData = FiscalJobData;

@Processor('nfse-emission')
@Injectable()
export class NfseEmissionProcessor extends WorkerHost {
  constructor(
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    private readonly workflow: NfseWorkflowService,
  ) {
    super();
  }
  async process(job: Job<NfseEmissionJobData>): Promise<void> {
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
