import { Inject, Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { LockPort } from '@/infra/redis/lock.port';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import {
  NfseWorkflowService,
  type FiscalJobData,
} from '../application/nfse-workflow.service';
import { runOrWaitForPortal } from './portal-wait';

export type NfseReconciliationJobData = FiscalJobData;

@Processor('nfse-reconciliation')
@Injectable()
export class NfseReconciliationProcessor extends WorkerHost {
  constructor(
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    private readonly workflow: NfseWorkflowService,
  ) {
    super();
  }
  async process(
    job: Job<NfseReconciliationJobData>,
    token?: string,
  ): Promise<void> {
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
}
