import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import {
  OUTBOX_RETENTION,
  type IOutboxRetention,
} from '../domain/outbox-retention';

/**
 * Daily 04:00 (São Paulo) purge of finished outbox messages (typeorm-outbox-retention.ts) and old notice content (infra/retention/notice-retention.ts).
 * A dry run (only counts and logs) unless DATA_RETENTION_ENABLED=true. Worker only.
 */
@Injectable()
export class OutboxRetentionScheduler {
  constructor(
    @Inject(OUTBOX_RETENTION) private readonly retention: IOutboxRetention,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 4 * * *', {
    name: 'outbox-retention',
    timeZone: 'America/Sao_Paulo',
    waitForCompletion: true,
  })
  async handle(): Promise<void> {
    await observeScheduledTask('outbox.retention', () => this.run());
  }

  async run(now = new Date()): Promise<void> {
    const enabled = this.config.get<boolean>('DATA_RETENTION_ENABLED') === true;
    await this.retention.purge(enabled, now);
  }
}
