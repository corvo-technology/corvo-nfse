import { queueFor } from '@/infra/redis/queue-routing';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';

const INTERVAL_MS = 30 * 60_000;
const DAY_MS = 86_400_000;

/**
 * Every 30 minutes, asks the fiscal portal about invoices parked in manual review (both environments,
 * every workspace). QUERY ONLY: each invoice becomes one `review: 'sweep'` reconciliation job that
 * authorizes it if the portal already has its DPS and otherwise changes nothing. It never resends,
 * never rejects and never discards. The per-run batch and the age limit bound the work.
 */
@Injectable()
export class ManualReviewSweepScheduler {
  private readonly logger = new Logger(ManualReviewSweepScheduler.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoices: IInvoiceRepository,
    private readonly queues: BullmqQueueService,
    private readonly config: ConfigService,
  ) {}

  @Cron('*/30 * * * *')
  async handle(): Promise<void> {
    if (!(this.config.get<boolean>('MANUAL_REVIEW_SWEEP_ENABLED') ?? true))
      return;
    await observeScheduledTask('invoice.manual-review-sweep', () => this.run());
  }

  private async run(): Promise<void> {
    const batch = this.config.get<number>('MANUAL_REVIEW_SWEEP_BATCH') ?? 50;
    const maxAgeDays =
      this.config.get<number>('MANUAL_REVIEW_SWEEP_MAX_AGE_DAYS') ?? 30;
    const now = Date.now();
    const since = new Date(now - maxAgeDays * DAY_MS);
    // One job id per invoice per half hour: overlapping runs never queue the same check twice.
    const bucket = Math.floor(now / INTERVAL_MS);
    let queued = 0;
    await this.discovery.visit('manual-review-sweep', async (tenantId) => {
      const room = batch - queued;
      if (room <= 0) return;
      const found = await this.invoices.findManualReview(tenantId, since, room);
      for (const invoice of found) {
        try {
          await this.queues.add(
            queueFor('nfse-reconciliation', invoice.environment),
            'reconcile',
            {
              invoiceId: invoice.id,
              tenantId: invoice.tenantId,
              companyId: invoice.companyId,
              review: 'sweep',
            },
            {
              idempotencyKey: `review-sweep:${invoice.id}:${bucket}`,
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: 100,
            },
          );
          queued += 1;
        } catch (error: unknown) {
          this.logger.error(
            { err: error, invoiceId: invoice.id },
            'Could not queue the manual review check',
          );
        }
      }
    });
    this.logger.log(
      { queued, batch, maxAgeDays },
      'Manual review sweep queued checks',
    );
  }
}
