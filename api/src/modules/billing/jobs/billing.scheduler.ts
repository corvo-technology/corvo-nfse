import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingService } from '../application/billing.service';

@Injectable()
export class BillingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingScheduler.name);
  constructor(private readonly billing: BillingService) {}
  async onApplicationBootstrap() {
    await this.reconcile();
  }
  @Cron('0 * * * *', { waitForCompletion: true })
  async reconcile() {
    try {
      await this.billing.reconcile();
    } catch (error: unknown) {
      this.logger.error({ event: 'billing_reconcile_failed', error });
    }
  }
}
