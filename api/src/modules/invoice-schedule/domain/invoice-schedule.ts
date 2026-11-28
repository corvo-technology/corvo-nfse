import { randomUUID } from 'node:crypto';
import {
  FiscalValidationError,
  type FiscalIssueCode,
} from '@/shared/fiscal/fiscal-validation-error';
import {
  type Frequency,
  firstOccurrenceAfter,
  todayInSaoPaulo,
  tomorrowInSaoPaulo,
} from './recurrence';
import { DateTime } from 'luxon';

export type ScheduleDocumentType = 'nfse' | 'nfe';
export type ScheduleKind = 'once' | 'recurring';
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type PauseReason = 'customer' | 'failures';
export type ScheduleEnvironment = 'test' | 'live';

/** Failures in a row on the same occurrence before the schedule pauses itself. */
export const MAX_FAILED_ATTEMPTS = 3;

/** A 422 like any other fiscal validation: the existing filter renders it with `details`. */
export class ScheduleValidationError extends FiscalValidationError {
  constructor(
    readonly field: string,
    readonly code: FiscalIssueCode,
    message: string,
  ) {
    super([{ field, code, message }]);
    this.name = 'ScheduleValidationError';
  }
}

export class ScheduleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleStateError';
  }
}

export interface InvoiceScheduleProps {
  id: string;
  tenantId: string;
  environment: ScheduleEnvironment;
  companyId: string;
  /** What each run issues. */
  documentType: ScheduleDocumentType;
  kind: ScheduleKind;
  frequency: Frequency | null;
  anchorOn: string;
  endsOn: string | null;
  invoiceInput: Record<string, unknown>;
  status: ScheduleStatus;
  pauseReason: PauseReason | null;
  occurrenceIndex: number;
  nextRunOn: string | null;
  attempts: number;
  lastRunOn: string | null;
  createdBy: string | null;
  /** The caller's Idempotency-Key and a hash of the request, to replay a retry instead of duplicating. */
  idempotencyKey: string | null;
  requestHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleInput {
  tenantId: string;
  environment: ScheduleEnvironment;
  companyId: string;
  /** NFS-e when left out. */
  documentType?: ScheduleDocumentType;
  kind: ScheduleKind;
  frequency: Frequency | null;
  firstOn: string;
  endsOn: string | null;
  invoiceInput: Record<string, unknown>;
  createdBy: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
}

export interface UpdateScheduleInput {
  invoiceInput?: Record<string, unknown>;
  endsOn?: string | null;
  frequency?: Frequency;
  anchorOn?: string;
}

/** A recurring schedule may start a full month ahead (issue now, repeat monthly); a single one keeps the plain horizon. */
const RECURRING_MIN_HORIZON_DAYS = 31;
const horizonFor = (kind: ScheduleKind, horizonDays: number): number =>
  kind === 'recurring'
    ? Math.max(horizonDays, RECURRING_MIN_HORIZON_DAYS)
    : horizonDays;

export class InvoiceSchedule {
  private constructor(private state: InvoiceScheduleProps) {}

  static create(
    input: CreateScheduleInput,
    now: Date,
    horizonDays: number,
  ): InvoiceSchedule {
    const today = todayInSaoPaulo(now);
    const horizon = horizonFor(input.kind, horizonDays);
    const lastAllowed = DateTime.fromISO(today, { zone: 'utc' })
      .plus({ days: horizon })
      .toISODate()!;
    if (input.firstOn < tomorrowInSaoPaulo(now))
      throw new ScheduleValidationError(
        'competenceDate',
        'first_date_too_soon',
        'The first date must be tomorrow or later',
      );
    if (input.firstOn > lastAllowed)
      throw new ScheduleValidationError(
        'competenceDate',
        'schedule_horizon_exceeded',
        `The first date cannot be more than ${horizon} days ahead`,
      );
    if (input.kind === 'recurring' && !input.frequency)
      throw new ScheduleValidationError(
        'recurrence.frequency',
        'required',
        'recurrence.frequency is required for a recurring schedule',
      );
    if (input.kind === 'once' && (input.frequency || input.endsOn))
      throw new ScheduleValidationError(
        'recurrence',
        'not_allowed',
        'A single schedule has no recurrence',
      );
    if (input.endsOn && input.endsOn <= input.firstOn)
      throw new ScheduleValidationError(
        'recurrence.endsOn',
        'ends_before_start',
        'recurrence.endsOn must be after the first date',
      );
    return new InvoiceSchedule({
      id: randomUUID(),
      tenantId: input.tenantId,
      environment: input.environment,
      companyId: input.companyId,
      documentType: input.documentType ?? 'nfse',
      kind: input.kind,
      frequency: input.frequency,
      anchorOn: input.firstOn,
      endsOn: input.endsOn,
      invoiceInput: input.invoiceInput,
      status: 'active',
      pauseReason: null,
      occurrenceIndex: 0,
      nextRunOn: input.firstOn,
      attempts: 0,
      lastRunOn: null,
      createdBy: input.createdBy,
      idempotencyKey: input.idempotencyKey ?? null,
      requestHash: input.requestHash ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: InvoiceScheduleProps): InvoiceSchedule {
    return new InvoiceSchedule({ ...props });
  }

  get props(): Readonly<InvoiceScheduleProps> {
    return this.state;
  }

  get isRunnable(): boolean {
    return this.state.status === 'active';
  }

  /** The pending occurrence became a note. */
  recordIssued(today: string): void {
    this.state.lastRunOn = today;
    this.state.attempts = 0;
    this.advance(today);
    this.touch();
  }

  /** The pending occurrence could not be issued; the third failure in a row pauses it. */
  recordFailure(today: string): { paused: boolean } {
    this.state.lastRunOn = today;
    this.state.attempts += 1;
    this.touch();
    if (this.state.attempts < MAX_FAILED_ATTEMPTS) return { paused: false };
    this.state.status = 'paused';
    this.state.pauseReason = 'failures';
    this.state.nextRunOn = null;
    return { paused: true };
  }

  pause(): void {
    if (this.state.status !== 'active')
      throw new ScheduleStateError('Only an active schedule can be paused');
    this.state.status = 'paused';
    this.state.pauseReason = 'customer';
    this.state.nextRunOn = null;
    this.touch();
  }

  resume(today: string): void {
    if (this.state.status !== 'paused')
      throw new ScheduleStateError('Only a paused schedule can be resumed');
    this.state.status = 'active';
    this.state.pauseReason = null;
    this.state.attempts = 0;
    // A single schedule is simply due again; a recurring one skips what passed.
    if (this.state.kind === 'once')
      this.state.nextRunOn =
        this.state.anchorOn > today ? this.state.anchorOn : today;
    else this.advance(today);
    this.touch();
  }

  cancel(): void {
    this.assertEditable();
    this.state.status = 'cancelled';
    this.state.nextRunOn = null;
    this.touch();
  }

  update(
    patch: UpdateScheduleInput,
    today: string,
    horizonDays?: number,
  ): void {
    this.assertEditable();
    const anchor = patch.anchorOn ?? this.state.anchorOn;
    const endsOn =
      patch.endsOn !== undefined ? patch.endsOn : this.state.endsOn;
    const horizon =
      horizonDays === undefined
        ? undefined
        : horizonFor(this.state.kind, horizonDays);
    if (
      patch.anchorOn &&
      patch.anchorOn !== this.state.anchorOn &&
      horizon !== undefined &&
      patch.anchorOn >
        DateTime.fromISO(today, { zone: 'utc' })
          .plus({ days: horizon })
          .toISODate()!
    )
      throw new ScheduleValidationError(
        'competenceDate',
        'schedule_horizon_exceeded',
        `The first date cannot be more than ${horizon} days ahead`,
      );
    // Checked against the date the schedule will have AFTER this change, not the old one.
    if (
      (patch.endsOn !== undefined || patch.anchorOn !== undefined) &&
      endsOn &&
      endsOn <= anchor
    )
      throw new ScheduleValidationError(
        'recurrence.endsOn',
        'ends_before_start',
        'recurrence.endsOn must be after the first date',
      );
    if (patch.invoiceInput) this.state.invoiceInput = patch.invoiceInput;
    if (patch.endsOn !== undefined) this.state.endsOn = patch.endsOn;
    const reschedules =
      (patch.frequency && patch.frequency !== this.state.frequency) ||
      (patch.anchorOn && patch.anchorOn !== this.state.anchorOn);
    if (reschedules) {
      if (this.state.kind === 'once' && patch.frequency)
        throw new ScheduleValidationError(
          'recurrence',
          'not_allowed',
          'A single schedule has no recurrence',
        );
      if (patch.frequency) this.state.frequency = patch.frequency;
      if (patch.anchorOn) this.state.anchorOn = patch.anchorOn;
      this.state.attempts = 0;
      if (this.state.status === 'active') {
        if (this.state.kind === 'once') {
          if (this.state.anchorOn <= today)
            throw new ScheduleValidationError(
              'competenceDate',
              'first_date_too_soon',
              'The date must be after today',
            );
          this.state.nextRunOn = this.state.anchorOn;
        } else this.advance(today);
      }
    }
    if (
      this.state.status === 'active' &&
      this.state.endsOn &&
      this.state.nextRunOn &&
      this.state.nextRunOn > this.state.endsOn
    )
      this.complete();
    this.touch();
  }

  /** Moves to the first occurrence after `today`, or completes when there is none left. */
  private advance(today: string): void {
    if (this.state.kind === 'once' || !this.state.frequency)
      return this.complete();
    const next = firstOccurrenceAfter(
      this.state.anchorOn,
      this.state.frequency,
      today,
    );
    if (this.state.endsOn && next.on > this.state.endsOn)
      return this.complete();
    this.state.occurrenceIndex = next.index;
    this.state.nextRunOn = next.on;
  }

  private complete(): void {
    this.state.status = 'completed';
    this.state.nextRunOn = null;
  }

  private assertEditable(): void {
    if (this.state.status === 'cancelled' || this.state.status === 'completed')
      throw new ScheduleStateError(
        `A ${this.state.status} schedule cannot be changed`,
      );
  }

  private touch(): void {
    this.state.updatedAt = new Date();
  }
}
