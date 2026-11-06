import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScheduleRunner } from '../application/schedule-runner.service';
import { SCHEDULE_ZONE, todayInSaoPaulo } from '../domain/recurrence';

/** Monday to Friday at 09:00 São Paulo: weekend occurrences are simply picked up on Monday. */
export const SCHEDULE_CRON_EXPRESSION = '0 9 * * 1-5';

@Injectable()
export class ScheduleCron {
  private readonly logger = new Logger(ScheduleCron.name);

  constructor(private readonly runner: ScheduleRunner) {}

  @Cron(SCHEDULE_CRON_EXPRESSION, {
    name: 'invoice-schedules',
    timeZone: SCHEDULE_ZONE,
    waitForCompletion: true,
  })
  async run(): Promise<void> {
    try {
      const summary = await this.runner.runDue(todayInSaoPaulo());
      this.logger.log({ event: 'invoice_schedules_run', ...summary });
    } catch (error) {
      this.logger.error({
        event: 'invoice_schedules_run_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
