import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { captureRuntimeException } from '@/infra/observability/sentry-reporter';
import type { OutboxConfig } from '@/infra/config/configuration';
import {
  OUTBOX_REPOSITORY,
  type IOutboxRepository,
} from '../domain/outbox.repository';
import type { OutboxMessage } from '../domain/outbox-message';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { outboxBackoffMs } from './outbox-backoff';
import {
  recordOutboxPendingAge,
  recordOutboxDead,
  recordOutboxFailure,
  recordOutboxLatency,
  recordOutboxPublished,
} from '../observability/outbox.metrics';

@Injectable()
export class OutboxRelay
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxRelay.name);
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repo: IOutboxRepository,
    private readonly registry: OutboxHandlerRegistry,
    private readonly config: ConfigService,
  ) {}

  private settings(): OutboxConfig {
    const settings = this.config.get<OutboxConfig>('outbox');
    if (!settings) throw new Error('Missing outbox configuration');
    return settings;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) =>
        this.logger.error({ err: error }, 'Outbox relay tick failed'),
      );
    }, this.settings().relayIntervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const { batchSize, leaseMs } = this.settings();
      const oldest = await runAsSystem('outbox-relay', () =>
        this.repo.oldestPendingAvailableAt(now),
      );
      recordOutboxPendingAge(
        oldest ? Math.max(0, (now.getTime() - oldest.getTime()) / 1000) : 0,
      );
      const claimed = await runAsSystem('outbox-relay', () =>
        this.repo.claimBatch(now, batchSize, new Date(now.getTime() + leaseMs)),
      );
      for (const message of claimed) await this.dispatch(message, now);
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private async dispatch(
    message: OutboxMessage,
    claimedAt: Date,
  ): Promise<void> {
    const { maxAttempts } = this.settings();
    try {
      const handler = this.registry.get(message.type);
      if (!handler)
        throw new Error(`No outbox handler for type ${message.type}`);
      await runWithTenant(message.tenantId, () => handler.handle(message));
      await runWithTenant(message.tenantId, () =>
        this.repo.complete(message.id, message.tenantId, new Date()),
      );
      recordOutboxPublished(message.type);
      recordOutboxLatency(
        message.type,
        (Date.now() - claimedAt.getTime()) / 1000,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordOutboxFailure(message.type);
      if (message.attempts >= maxAttempts) {
        recordOutboxDead(message.type);
        this.logger.error(
          {
            outboxId: message.id,
            invoiceId: message.aggregateId,
            type: message.type,
            tenantId: message.tenantId,
            attempts: message.attempts,
          },
          'Outbox message is dead',
        );
        captureRuntimeException(error, 'worker', `outbox.dead:${message.type}`);
        await runWithTenant(message.tenantId, () =>
          this.repo.markDead(message.id, message.tenantId, reason, new Date()),
        );
        return;
      }
      await runWithTenant(message.tenantId, () =>
        this.repo.release(
          message.id,
          message.tenantId,
          reason,
          new Date(claimedAt.getTime() + outboxBackoffMs(message.attempts)),
          new Date(),
        ),
      );
    }
  }
}
