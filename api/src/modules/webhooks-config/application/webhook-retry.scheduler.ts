import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { WebhookOutboxService } from './webhook-outbox.service';

/**
 * Safety net and retries: every few seconds sends the deliveries that are due.
 * Runs only where the schedule module is loaded (the worker). First attempts normally
 * leave right after saving; this picks up retries and anything that send missed.
 */
@Injectable()
export class WebhookRetryScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WebhookRetryScheduler.name);
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly outboxService: WebhookOutboxService,
    private readonly config: ConfigService,
    @Optional() private readonly registry?: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.registry) return;
    const every =
      this.config.get<{ retryIntervalMs: number }>('webhooks')
        ?.retryIntervalMs ?? 10_000;
    this.timer = setInterval(() => void this.handleRetries(), every);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async handleRetries(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.outboxService.processNext();
    } catch (error: unknown) {
      this.logger.error(
        `Retry processing failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
