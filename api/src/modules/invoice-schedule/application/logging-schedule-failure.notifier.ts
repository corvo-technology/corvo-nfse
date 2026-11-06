import { Injectable, Logger } from '@nestjs/common';
import type { InvoiceSchedule } from '../domain/invoice-schedule';
import {
  ScheduleFailureNotifier,
  type FailedScheduleItem,
} from '../domain/schedule-failure.notifier';

/** Writes the failures to the log. The e-mail notifier takes over from here. */
@Injectable()
export class LoggingScheduleFailureNotifier extends ScheduleFailureNotifier {
  private readonly logger = new Logger(LoggingScheduleFailureNotifier.name);

  retryNotice(tenantId: string, items: FailedScheduleItem[]): Promise<void> {
    this.logger.warn({
      event: 'invoice_schedule_retry',
      tenantId,
      schedules: items.map((item) => ({
        id: item.schedule.props.id,
        code: item.code,
      })),
    });
    return Promise.resolve();
  }

  paused(schedule: InvoiceSchedule, reason: string): Promise<void> {
    this.logger.warn({
      event: 'invoice_schedule_paused',
      tenantId: schedule.props.tenantId,
      scheduleId: schedule.props.id,
      reason,
    });
    return Promise.resolve();
  }
}
