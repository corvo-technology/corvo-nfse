import type { InvoiceSchedule } from './invoice-schedule';

export interface FailedScheduleItem {
  schedule: InvoiceSchedule;
  /** Public error code of the refusal (e.g. ERROR_QUOTA_EXCEEDED). */
  code: string;
  reason: string;
}

/** What the customer is told when a run fails. Implemented with e-mail; the runner never depends on how. */
export abstract class ScheduleFailureNotifier {
  /** One notice per tenant per run, listing every schedule that failed and will be retried. */
  abstract retryNotice(
    tenantId: string,
    items: FailedScheduleItem[],
  ): Promise<void>;
  /** The schedule paused itself after its third failure. */
  abstract paused(item: FailedScheduleItem): Promise<void>;
}
