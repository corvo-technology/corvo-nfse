import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { InvoiceLifecycleService } from '@/modules/invoice/application/invoice-lifecycle.service';
import type { BatchSubmitEntry } from '@/modules/invoice/application/invoice-lifecycle.service';
import { toBatchItemError } from '@/modules/invoice/application/invoice-batch-error';
import { IdempotencyConflictError } from '@/modules/invoice/domain/errors';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '@/modules/invoice/domain/invoice.repository';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import type { InvoiceSchedule } from '../domain/invoice-schedule';
import { InvoiceScheduleRepository } from '../domain/invoice-schedule.repository';
import {
  ScheduleFailureNotifier,
  type FailedScheduleItem,
} from '../domain/schedule-failure.notifier';
import {
  MAX_ACTIVE_SCHEDULES,
  SCHEDULE_INVOICE_PORT,
  type ScheduleInvoicePort,
} from './schedule.service';

export const SCHEDULE_TENANT_PAGE_SIZE = 'SCHEDULE_TENANT_PAGE_SIZE';

export interface RunSummary {
  issued: number;
  failed: number;
  paused: number;
  /** Tenants whose run was rolled back by an unexpected error. */
  errors: number;
}

type Step =
  | {
      schedule: InvoiceSchedule;
      occurrenceOn: string;
      state: 'ready';
      entry: BatchSubmitEntry;
      key: string;
    }
  | {
      schedule: InvoiceSchedule;
      occurrenceOn: string;
      state: 'issued';
      invoiceId: string;
    }
  | {
      schedule: InvoiceSchedule;
      occurrenceOn: string;
      state: 'failed';
      code: string;
      message: string;
    };

interface TenantOutcome {
  issued: number;
  failed: FailedScheduleItem[];
  paused: FailedScheduleItem[];
}

const IDEMPOTENCY_CONFLICT = 'ERROR_IDEMPOTENCY_CONFLICT';

@Injectable()
export class ScheduleRunner {
  private readonly logger = new Logger(ScheduleRunner.name);

  constructor(
    private readonly repo: InvoiceScheduleRepository,
    @Inject(SCHEDULE_INVOICE_PORT)
    private readonly invoices: ScheduleInvoicePort,
    @Inject(InvoiceLifecycleService)
    private readonly lifecycle: Pick<InvoiceLifecycleService, 'submitBatch'>,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: Pick<
      IInvoiceRepository,
      'findByIdempotencyKey'
    >,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly notifier: ScheduleFailureNotifier,
    @Optional()
    @Inject(SCHEDULE_TENANT_PAGE_SIZE)
    private readonly pageSize: number = 500,
  ) {}

  /** Turns every schedule due on `today` (or earlier) into a note. One transaction per tenant. */
  async runDue(today: string): Promise<RunSummary> {
    const summary: RunSummary = { issued: 0, failed: 0, paused: 0, errors: 0 };
    let after: string | undefined;
    for (;;) {
      const tenants = await this.repo.listDueTenantIds(
        today,
        this.pageSize,
        after,
      );
      for (const tenantId of tenants) {
        try {
          const outcome = await this.runTenant(tenantId, today);
          summary.issued += outcome.issued;
          summary.failed += outcome.failed.length + outcome.paused.length;
          summary.paused += outcome.paused.length;
        } catch (error) {
          summary.errors += 1;
          this.logger.error({
            event: 'invoice_schedule_tenant_run_failed',
            tenantId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (tenants.length < this.pageSize) break;
      after = tenants[tenants.length - 1];
    }
    return summary;
  }

  private async runTenant(
    tenantId: string,
    today: string,
  ): Promise<TenantOutcome> {
    // The tenant scope wraps the transaction: the RLS settings are applied when the connection is acquired.
    const outcome = await runWithTenant(tenantId, () =>
      this.unitOfWork.execute(() => this.process(tenantId, today)),
    );
    await this.notify(tenantId, outcome);
    return outcome;
  }

  /** Everything here commits or rolls back together: the notes, the schedules' next dates and the log. */
  private async process(
    tenantId: string,
    today: string,
  ): Promise<TenantOutcome> {
    const claimed = (
      await this.repo.claimDueForTenant(tenantId, today, MAX_ACTIVE_SCHEDULES)
    ).filter((schedule) => schedule.isRunnable);

    const steps: Step[] = [];
    for (const schedule of claimed)
      steps.push(await this.prepare(schedule, tenantId, today));

    const ready = steps.filter(
      (step): step is Extract<Step, { state: 'ready' }> =>
        step.state === 'ready',
    );
    const outcomes = ready.length
      ? await this.lifecycle.submitBatch(
          tenantId,
          ready.map((step) => step.entry),
        )
      : [];
    const settled = new Map<InvoiceSchedule, Step>();
    for (const [index, step] of ready.entries()) {
      const outcome = outcomes[index];
      if (outcome?.ok)
        settled.set(step.schedule, {
          schedule: step.schedule,
          occurrenceOn: step.occurrenceOn,
          state: 'issued',
          invoiceId: outcome.replayed?.id ?? step.entry.invoice.id,
        });
      else if (outcome?.code === IDEMPOTENCY_CONFLICT)
        settled.set(step.schedule, await this.alreadyCreated(step, tenantId));
      else
        settled.set(step.schedule, {
          schedule: step.schedule,
          occurrenceOn: step.occurrenceOn,
          state: 'failed',
          code: outcome?.code ?? 'ERROR_INTERNAL',
          message: outcome?.message ?? 'Item was not saved',
        });
    }

    const result: TenantOutcome = { issued: 0, failed: [], paused: [] };
    for (const step of steps) {
      const final = settled.get(step.schedule) ?? step;
      const { schedule } = final;
      const attempt = schedule.props.attempts + 1;
      const base = {
        tenantId,
        scheduleId: schedule.props.id,
        occurrenceOn: final.occurrenceOn,
        ranOn: today,
        attempt,
      };
      if (final.state === 'issued') {
        schedule.recordIssued(today);
        await this.repo.addRun({
          ...base,
          outcome: 'issued',
          invoiceId: final.invoiceId,
          errorCode: null,
          errorMessage: null,
        });
        result.issued += 1;
      } else if (final.state === 'failed') {
        const { paused } = schedule.recordFailure(today);
        await this.repo.addRun({
          ...base,
          outcome: 'failed',
          invoiceId: null,
          errorCode: final.code,
          errorMessage: final.message,
        });
        (paused ? result.paused : result.failed).push({
          schedule,
          code: final.code,
          reason: final.message,
        });
      }
      await this.repo.save(schedule);
    }
    return result;
  }

  /** Validates the body as a normal emission of today and builds the invoice, without saving it. */
  private async prepare(
    schedule: InvoiceSchedule,
    tenantId: string,
    today: string,
  ): Promise<Step> {
    const occurrenceOn = schedule.props.nextRunOn ?? today;
    const key = `schedule:${schedule.props.id}:${occurrenceOn}`;
    try {
      const prepared = await this.invoices.prepareEmissionInEnvironment(
        {
          ...schedule.props.invoiceInput,
          competenceDate: today,
        } as CreateInvoiceDto,
        tenantId,
        schedule.props.environment,
        key,
      );
      if (prepared.kind === 'replay')
        return {
          schedule,
          occurrenceOn,
          state: 'issued',
          invoiceId: prepared.invoice.id,
        };
      return {
        schedule,
        occurrenceOn,
        state: 'ready',
        key,
        entry: {
          invoice: prepared.invoice,
          event: prepared.event,
          requestHash: prepared.requestHash,
        },
      };
    } catch (error) {
      if (error instanceof IdempotencyConflictError)
        return this.alreadyCreated({ schedule, occurrenceOn, key }, tenantId);
      const item = toBatchItemError(error);
      // Anything unexpected must abort this tenant's transaction, not hide as a failed attempt.
      if (!item) throw error;
      return {
        schedule,
        occurrenceOn,
        state: 'failed',
        code: item.code,
        message: item.message,
      };
    }
  }

  /**
   * The key of this occurrence was already used with another day's competence: the note of an earlier
   * attempt exists. Count it as issued instead of creating a second one.
   */
  private async alreadyCreated(
    step: { schedule: InvoiceSchedule; occurrenceOn: string; key: string },
    tenantId: string,
  ): Promise<Step> {
    const existing = await this.invoiceRepo.findByIdempotencyKey(
      step.key,
      tenantId,
      step.schedule.props.environment,
    );
    if (existing)
      return {
        schedule: step.schedule,
        occurrenceOn: step.occurrenceOn,
        state: 'issued',
        invoiceId: existing.id,
      };
    return {
      schedule: step.schedule,
      occurrenceOn: step.occurrenceOn,
      state: 'failed',
      code: IDEMPOTENCY_CONFLICT,
      message: 'Idempotency key was used with a different payload',
    };
  }

  /** After the commit. A notifier failure never undoes the run. The test environment never e-mails. */
  private async notify(
    tenantId: string,
    outcome: TenantOutcome,
  ): Promise<void> {
    const live = (item: FailedScheduleItem) =>
      item.schedule.props.environment === 'live';
    const retry = outcome.failed.filter(live);
    try {
      if (retry.length > 0) await this.notifier.retryNotice(tenantId, retry);
    } catch (error) {
      this.logNotifyFailure(tenantId, error);
    }
    for (const item of outcome.paused.filter(live)) {
      try {
        await this.notifier.paused(item);
      } catch (error) {
        this.logNotifyFailure(tenantId, error);
      }
    }
  }

  private logNotifyFailure(tenantId: string, error: unknown): void {
    this.logger.warn({
      event: 'invoice_schedule_notification_failed',
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
