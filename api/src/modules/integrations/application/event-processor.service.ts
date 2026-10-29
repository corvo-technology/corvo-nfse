import { Injectable, Logger } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  CLAIM_BATCH_SIZE,
  EVENT_LEASE_MS,
  MAX_EVENT_ATTEMPTS,
  nextAttemptDelayMs,
} from '../domain/integration-event';
import {
  IIntegrationEventRepository,
  type ClaimedEvent,
  type EventResult,
} from '../domain/integration-event.repository';
import { EventHandler } from './event-handler';

@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);
  /** Replaceable so tests get deterministic jitter. */
  random: () => number = Math.random;

  constructor(
    private readonly events: IIntegrationEventRepository,
    private readonly handler: EventHandler,
  ) {}

  /** Claims one batch and processes it. Returns how many events were claimed. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const claimed = await this.events.claimBatch(
      CLAIM_BATCH_SIZE,
      EVENT_LEASE_MS,
      now,
    );
    for (const event of claimed) await this.process(event, now);
    return claimed.length;
  }

  private async process(event: ClaimedEvent, now: Date): Promise<void> {
    let result: EventResult;
    try {
      const outcome = await runWithTenant(event.tenantId, () =>
        this.handler.handle(event),
      );
      result = outcome;
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      result =
        event.attempts >= MAX_EVENT_ATTEMPTS
          ? { state: 'dead', lastError: message }
          : {
              state: 'retry_pending',
              lastError: message,
              nextAttemptAt: new Date(
                now.getTime() + nextAttemptDelayMs(event.attempts, this.random),
              ),
            };
    }
    const stored = await this.events.markResult(event, result);
    if (!stored)
      this.logger.warn(`Lost the claim on integration event ${event.id}`);
  }
}
