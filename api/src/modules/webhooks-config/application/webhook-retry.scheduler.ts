/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WebhookOutboxService } from './webhook-outbox.service';

@Injectable()
export class WebhookRetryScheduler {
  private readonly logger = new Logger(WebhookRetryScheduler.name);

  constructor(private readonly outboxService: WebhookOutboxService) {}

  // Process pending retries every 30 seconds
  @Interval(30000)
  async handleRetries(): Promise<void> {
    try {
      await this.outboxService.processNext();
    } catch (error: any) {
      this.logger.error(`Retry processing failed: ${error.message}`);
    }
  }
}
