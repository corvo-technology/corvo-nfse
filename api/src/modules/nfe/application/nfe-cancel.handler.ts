import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import {
  NFE_CANCEL,
  type NfeEventMessagePayload,
} from '../domain/nfe-message-types';
import { NfeEventSender } from './nfe-event-sender';

/** `nfe.cancel`: sends the stored cancellation request (the signed XML made when it was asked for). */
@Injectable()
export class NfeCancelHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_CANCEL;

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
