import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import {
  NFE_CORRECT,
  type NfeEventMessagePayload,
} from '../domain/nfe-message-types';
import { NfeEventSender } from './nfe-event-sender';

/** `nfe.correct`: sends the stored correction letter. */
@Injectable()
export class NfeCorrectHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_CORRECT;

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly sender: NfeEventSender,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { eventId, tenantId, attempt } =
      message.payload as unknown as NfeEventMessagePayload;
    await this.sender.send(eventId, tenantId, message.environment, attempt);
  }
}
