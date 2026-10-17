import { Inject, Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import type { LockPort } from '@/infra/redis/lock.port';
import { FiscalReconciliationService } from '../application/fiscal/fiscal-reconciliation.service';

export const FISCAL_RECONCILE_QUEUE = 'nfse-fiscal-reconcile';

const LOCK_TTL_MS = 60_000;

export interface FiscalReconcileJobData {
  invoiceId: string;
  tenantId: string;
  companyId?: string;
}

/**
 * Reconciles the fiscal snapshot against the authorized NFS-e. Convergence is
 * guaranteed by the idempotent insert — the lock only avoids two workers
 * racing on the same invoice.
 */
@Processor(FISCAL_RECONCILE_QUEUE)
@Injectable()
export class FiscalReconciliationProcessor extends WorkerHost {
  constructor(
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    private readonly reconciler: FiscalReconciliationService,
  ) {
    super();
  }

  async process(job: Job<FiscalReconcileJobData>): Promise<void> {
    const lock = await this.locks.acquire(
      `nfse:fiscal-reconcile:${job.data.invoiceId}`,
      { ttlMs: LOCK_TTL_MS },
    );
    if (!lock)
      throw new Error(
        `Invoice fiscal reconciliation already being processed: ${job.data.invoiceId}`,
      );
    try {
      await this.reconciler.reconcileInvoice(
        job.data.invoiceId,
        job.data.tenantId,
      );
    } finally {
      await this.locks.release(lock);
    }
  }
}
