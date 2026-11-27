import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import {
  FISCAL_RECONCILIATION_REPOSITORY,
  type IFiscalReconciliationRepository,
} from '../domain/fiscal/reconciliation/fiscal-reconciliation.repository';
import {
  isPendingJobState,
  reconciliationJobKey,
  reconciliationJobKeys,
} from '../application/reconciliation-job';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';

const QUEUE_NAME = 'nfse-doc-prep';
const JOB_NAME = 'prepare';
const RECONCILE_QUEUE_NAME = 'nfse-fiscal-reconcile';
const RECONCILE_JOB_NAME = 'reconcile';

@Injectable()
export class DocsRecoveryScheduler {
  private readonly logger = new Logger(DocsRecoveryScheduler.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    private readonly queueService: BullmqQueueService,
    @Inject(FISCAL_RECONCILIATION_REPOSITORY)
    private readonly reconciliations: IFiscalReconciliationRepository,
  ) {}

  private async hasPendingReconciliation(invoiceId: string): Promise<boolean> {
    for (const key of reconciliationJobKeys(invoiceId)) {
      const state = await this.queueService.getJobStatus(
        'nfse-reconciliation',
        key.replace(/:/g, '_'),
      );
      if (isPendingJobState(state)) return true;
    }
    return false;
  }

  @Cron('*/5 * * * *')
  async handle(): Promise<void> {
    await observeScheduledTask('invoice.docs-recovery', () => this.recover());
  }

  private async recover(): Promise<void> {
    await this.discovery.visit('invoice-recovery', async (tenantId) => {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000);
      // queued invoices are owned by the outbox (also protects SCHEDULE invoices from early emission).
      const fiscal = await this.invoiceRepo.findPendingReconciliation(
        tenantId,
        cutoff,
        50,
      );
      for (const i of fiscal) {
        try {
          // One reconciliation chain per invoice: while one is queued, delayed or running, recovery waits.
          if (await this.hasPendingReconciliation(i.id)) continue;
          await this.queueService.add(
            'nfse-reconciliation',
            'recover',
            {
              invoiceId: i.id,
              tenantId: i.tenantId,
              companyId: i.companyId,
              attemptCount: 0,
            },
            {
              idempotencyKey: reconciliationJobKey(i.id, 0),
              attempts: 5,
              backoffMs: 30000,
              removeOnComplete: true,
              removeOnFail: true,
            },
          );
        } catch (err) {
          this.logger.error(
            `Failed to re-enqueue reconciliation for invoice ${i.id}:`,
            err,
          );
        }
      }
      const pending = await this.invoiceRepo.findAuthorizedWithoutDocuments(
        tenantId,
        cutoff,
        50,
      );

      for (const { id, tenantId, companyId } of pending) {
        try {
          await this.queueService.add(
            QUEUE_NAME,
            JOB_NAME,
            { invoiceId: id, tenantId, companyId },
            {
              attempts: 5,
              backoffMs: 10_000,
              removeOnComplete: false,
              removeOnFail: 1000,
            },
          );
          this.logger.log(`Re-enqueued doc-prep for invoice ${id}`);
        } catch (err) {
          this.logger.error(
            `Failed to re-enqueue doc-prep for invoice ${id}:`,
            err,
          );
        }
      }

      if (pending.length > 0) {
        this.logger.log(
          `Recovered ${pending.length} pending document preparations`,
        );
      }

      // Only authorized invoices carrying a fiscal snapshot and no
      // reconciliation row come back here (the repository filters queued work).
      const withoutReconciliation =
        await this.reconciliations.findAuthorizedWithoutReconciliation(
          tenantId,
          cutoff,
          50,
        );

      for (const { id, tenantId, companyId } of withoutReconciliation) {
        try {
          await this.queueService.add(
            RECONCILE_QUEUE_NAME,
            RECONCILE_JOB_NAME,
            { invoiceId: id, tenantId, companyId },
            {
              idempotencyKey: `fiscal-reconcile:${id}`,
              attempts: 5,
              backoffMs: 10_000,
              removeOnComplete: false,
              removeOnFail: 1000,
            },
          );
          this.logger.log(
            `Re-enqueued fiscal reconciliation for invoice ${id}`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to re-enqueue fiscal reconciliation for invoice ${id}:`,
            err,
          );
        }
      }

      if (withoutReconciliation.length > 0) {
        this.logger.log(
          `Recovered ${withoutReconciliation.length} pending fiscal reconciliations`,
        );
      }
    });
  }
}
