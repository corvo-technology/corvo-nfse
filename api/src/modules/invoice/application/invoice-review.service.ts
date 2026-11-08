import { Inject, Injectable } from '@nestjs/common';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import type { FiscalJobData } from './nfse-workflow.service';

export const REVIEW_ACTIONS = ['retry', 'discard'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export const MAX_REVIEW_BATCH = 100;

export type ReviewOutcome =
  | { id: string; outcome: 'accepted' }
  | {
      id: string;
      outcome: 'skipped';
      reason: 'not_found' | 'not_in_manual_review' | 'changed';
    };

/**
 * What a person can do with invoices in manual review, one or many at once.
 *
 * - retry: back to reconciliation with the SAME DPS. The provider asks the portal for that DPS
 *   before sending it, so this never issues a second NFS-e: it ends authorized (already there or
 *   accepted now), rejected (refused now) or, if the portal is still silent, back in review.
 * - discard: a worker asks the portal for the DPS. Only "never registered" rejects the invoice
 *   (and refunds its credit); if the NFS-e exists it becomes authorized instead.
 */
@Injectable()
export class InvoiceReviewService {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly queues: BullmqQueueService,
  ) {}

  async apply(
    tenantId: string,
    environment: ExecutionEnvironment,
    action: ReviewAction,
    invoiceIds: string[],
    actor: string,
  ): Promise<ReviewOutcome[]> {
    const outcomes: ReviewOutcome[] = [];
    for (const id of [...new Set(invoiceIds)])
      outcomes.push(await this.one(tenantId, environment, action, id, actor));
    return outcomes;
  }

  private async one(
    tenantId: string,
    environment: ExecutionEnvironment,
    action: ReviewAction,
    id: string,
    actor: string,
  ): Promise<ReviewOutcome> {
    const invoice = await this.invoices.findByIdAndTenantId(
      id,
      tenantId,
      environment,
    );
    if (!invoice) return { id, outcome: 'skipped', reason: 'not_found' };
    if (invoice.status !== 'manual_review')
      return { id, outcome: 'skipped', reason: 'not_in_manual_review' };
    const job: FiscalJobData = {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      tenantId: invoice.tenantId,
    };
    if (action === 'discard') {
      await this.queues.add(
        'nfse-reconciliation',
        'reconcile',
        { ...job, review: 'discard' },
        {
          idempotencyKey: `review-discard:${invoice.id}`,
          attempts: 3,
          backoffMs: 30000,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
      return { id, outcome: 'accepted' };
    }
    try {
      const applied = await this.lifecycle.transition(
        invoice,
        invoice.transitionTo(
          'reconciliation_required',
          `Retry with the same DPS requested in manual review by ${actor}`,
        ),
      );
      if (!applied) return { id, outcome: 'skipped', reason: 'changed' };
    } catch (error: unknown) {
      if (error instanceof ConcurrentInvoiceTransitionError)
        return { id, outcome: 'skipped', reason: 'changed' };
      throw error;
    }
    await this.queues.add(
      'nfse-reconciliation',
      'reconcile',
      {
        ...job,
        attemptCount: 0,
        uncertainSince: new Date().toISOString(),
      },
      {
        attempts: 5,
        backoffMs: 30000,
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
    return { id, outcome: 'accepted' };
  }
}
