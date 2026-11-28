import type { InvoiceSchedule, ScheduleStatus } from './invoice-schedule';

export interface ScheduleRun {
  id: string;
  tenantId: string;
  scheduleId: string;
  /** The due date this attempt was for (may be a weekend day). */
  occurrenceOn: string;
  /** The day it actually ran. */
  ranOn: string;
  attempt: number;
  outcome: 'issued' | 'failed';
  invoiceId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export type NewScheduleRun = Omit<ScheduleRun, 'id' | 'createdAt'>;

export interface ScheduleListFilter {
  status?: ScheduleStatus;
  companyId?: string;
  environment?: 'test' | 'live';
  /** Only these kinds of document; empty answers nothing. */
  documentTypes?: Array<'nfse' | 'nfe'>;
}
export interface SchedulePage {
  limit: number;
  offset: number;
}
export interface ScheduleListResult<T> {
  items: T[];
  total: number;
}

export abstract class InvoiceScheduleRepository {
  abstract insert(schedule: InvoiceSchedule): Promise<void>;
  /** `forUpdate` locks the row until the caller's transaction ends (needs one open). */
  abstract findById(
    id: string,
    tenantId: string,
    options?: { forUpdate?: boolean },
  ): Promise<InvoiceSchedule | null>;
  abstract findByIdempotencyKey(
    tenantId: string,
    environment: 'test' | 'live',
    key: string,
  ): Promise<InvoiceSchedule | null>;
  abstract list(
    tenantId: string,
    filter: ScheduleListFilter,
    page: SchedulePage,
  ): Promise<ScheduleListResult<InvoiceSchedule>>;
  abstract save(schedule: InvoiceSchedule): Promise<void>;
  abstract countActive(tenantId: string): Promise<number>;
  /**
   * System scope: tenants that have something due today or earlier, ordered by id. Pass the last
   * id of the previous page as `afterTenantId`: a tenant whose schedules stay due after a failed
   * attempt would otherwise be returned forever.
   */
  abstract listDueTenantIds(
    today: string,
    limit: number,
    afterTenantId?: string,
  ): Promise<string[]>;
  /**
   * Inside the caller's transaction: locks (FOR UPDATE SKIP LOCKED) the tenant's active schedules
   * due today or earlier, oldest first. Two runners never receive the same schedule.
   */
  abstract claimDueForTenant(
    tenantId: string,
    today: string,
    limit: number,
  ): Promise<InvoiceSchedule[]>;
  abstract addRun(run: NewScheduleRun): Promise<void>;
  /**
   * Number of the next attempt for this occurrence, from the log: one more than the highest attempt
   * already recorded. The schedule's own counter can be reset (pause and resume, edits) while the
   * log, which is unique per (schedule, occurrence, attempt), keeps the history.
   */
  abstract nextAttempt(
    scheduleId: string,
    tenantId: string,
    occurrenceOn: string,
  ): Promise<number>;
  /**
   * Batch variant of nextAttempt: one query for many (schedule, occurrence) pairs.
   * The map key is `${scheduleId}:${occurrenceOn}`.
   */
  abstract nextAttempts(
    tenantId: string,
    items: Array<{ scheduleId: string; occurrenceOn: string }>,
  ): Promise<Map<string, number>>;
  /** Batch variant of addRun: one INSERT for the whole list. */
  abstract addRuns(tenantId: string, runs: NewScheduleRun[]): Promise<void>;
  abstract listRuns(
    scheduleId: string,
    tenantId: string,
    page: SchedulePage,
  ): Promise<ScheduleListResult<ScheduleRun>>;
}
