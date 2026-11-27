import { queueFor } from '@/infra/redis/queue-routing';
import { Inject, Injectable } from '@nestjs/common';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import type { Invoice } from '../domain/invoice';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { recordSafely } from '@/shared/audit/record-safely';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import type { FiscalJobData } from './nfse-workflow.service';
import { reconciliationJobKey } from './reconciliation-job';
import {
  DPS_USED_BY_OTHER_NFSE,
  PORTAL_NFSE_WRONG_ENVIRONMENT,
} from '../domain/fiscal/portal-nfse-match';

export const REVIEW_ACTIONS = ['retry', 'discard'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export const MAX_REVIEW_BATCH = 100;

export type ReviewOutcome =
  | { id: string; outcome: 'accepted' }
  | {
      id: string;
      outcome: 'skipped';
      reason:
        | 'not_found'
        | 'not_in_manual_review'
        | 'changed'
        | 'dps_used_by_other_nfse';
    };

/**
 * What a person can do with invoices in manual review, one or many at once.
 *
 * - retry: back to reconciliation with the SAME DPS. The provider asks the portal for that DPS
 *   before sending it, so this never issues a second NFS-e: it ends authorized (already there or
 *   accepted now), rejected (refused now) or, if the portal is still silent, back in review.
 * - discard: a worker asks the portal for the DPS. "Never registered" rejects the invoice (and
 *   refunds its credit); if OUR NFS-e exists it becomes authorized instead; if the DPS belongs to
 *   another NFS-e (number already used elsewhere) it is rejected and refunded too.
 *
 * An invoice whose DPS number the portal already has on another note is never retried: the same
 * number would be refused (E0014) or return that other note again. It can only be discarded; the
 * sale is issued again as a new invoice, which takes a new number.
 */
@Injectable()
export class InvoiceReviewService {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly queues: BullmqQueueService,
    private readonly audit: AccountAuditRecorder,
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
    if (
      action === 'retry' &&
      invoice.toSnapshot().lastErrorCode === DPS_USED_BY_OTHER_NFSE
    ) {
      // The portal's note is someone else's: emit again with the next free DPS number.
      await this.queues.add(
        queueFor('nfse-reconciliation', environment),
        'reconcile',
        { ...job, review: 'renumber' },
        {
          idempotencyKey: `review-renumber:${invoice.id}`,
          attempts: 5,
          backoffMs: 30000,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
      await this.recordAudit(invoice, environment, 'invoice.review_retried');
      return { id, outcome: 'accepted' };
    }
    if (
      action === 'retry' &&
      [PORTAL_NFSE_WRONG_ENVIRONMENT].includes(
        invoice.toSnapshot().lastErrorCode ?? '',
      )
    )
      return { id, outcome: 'skipped', reason: 'dps_used_by_other_nfse' };
    if (action === 'discard') {
      await this.queues.add(
        queueFor('nfse-reconciliation', environment),
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
      await this.recordAudit(invoice, environment, 'invoice.review_discarded');
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
      queueFor('nfse-reconciliation', environment),
      'reconcile',
      {
        ...job,
        attemptCount: 0,
        uncertainSince: new Date().toISOString(),
      },
      {
        idempotencyKey: reconciliationJobKey(invoice.id, 0),
        attempts: 5,
        backoffMs: 30000,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    await this.recordAudit(invoice, environment, 'invoice.review_retried');
    return { id, outcome: 'accepted' };
  }

  private recordAudit(
    invoice: Invoice,
    environment: ExecutionEnvironment,
    action: 'invoice.review_retried' | 'invoice.review_discarded',
  ) {
    return recordSafely(this.audit, {
      tenantId: invoice.tenantId,
      environment,
      action,
      target: {
        type: 'invoice',
        id: invoice.id,
        label: invoice.customerSnapshot?.name ?? 'Consumidor',
      },
    });
  }
}
