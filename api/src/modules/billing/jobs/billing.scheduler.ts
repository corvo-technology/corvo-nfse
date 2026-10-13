import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingService } from '../application/billing.service';
import { OverageReportService } from '../application/overage-report.service';

@Injectable()
export class BillingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingScheduler.name);
  constructor(
    private readonly billing: BillingService,
    private readonly overage: OverageReportService,
  ) {}
  async onApplicationBootstrap() {
    await this.reconcile();
    await this.report();
  }
  @Cron('0 * * * *', { waitForCompletion: true })
  async reconcile() {
    try {
      await this.billing.reconcile();
    } catch (error: unknown) {
      this.logger.error({ event: 'billing_reconcile_failed', error });
    }
  }
  @Cron('*/10 * * * *', { waitForCompletion: true })
  async report() {
    try {
      await this.overage.report();
    } catch (error: unknown) {
      this.logger.error({ event: 'billing_report_failed', error });
    }
  }
}
