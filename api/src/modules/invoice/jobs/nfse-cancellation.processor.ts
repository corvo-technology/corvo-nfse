import { Inject, Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { LockPort } from '@/infra/redis/lock.port';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import type { FiscalJobData } from '../application/nfse-workflow.service';
import { NfseCancellationService } from '../application/nfse-cancellation.service';

@Processor('nfse-cancellation')
@Injectable()
export class NfseCancellationProcessor extends WorkerHost {
  constructor(
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    private readonly cancellation: NfseCancellationService,
  ) {
    super();
  }
  async process(job: Job<FiscalJobData>): Promise<void> {
    // Same lock as emission/reconciliation: one fiscal operation per invoice.
    const lock = await this.locks.acquire(
      `nfse:invoice:${job.data.invoiceId}`,
      { ttlMs: 300000 },
    );
    if (!lock) throw new Error('Invoice is already being processed');
    try {
      await this.cancellation.process(job.data);
    } finally {
      await this.locks.release(lock);
    }
  }
}
