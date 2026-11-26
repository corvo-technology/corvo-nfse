import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import {
  NFE_RECONCILE,
  type NfeEventMessagePayload,
  type NfeMessagePayload,
} from '../domain/nfe-message-types';
import { NfeConsultService } from './nfe-consult.service';
import { NfeEventReconcile } from './nfe-event-reconcile';

/**
 * `nfe.reconcile`: the automatic look at the SEFAZ for a document whose answer was lost, or, when
 * the message names an event, for a cancellation or correction letter whose answer was lost.
 */
@Injectable()
export class NfeReconcileHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_RECONCILE;

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly consult: NfeConsultService,
    private readonly events: NfeEventReconcile,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { documentId, tenantId } =
      message.payload as unknown as NfeMessagePayload;
    const { eventId, attempt } =
      message.payload as Partial<NfeEventMessagePayload>;
    if (eventId) {
      await this.events.reconcile(
        eventId,
        tenantId,
        message.environment,
        attempt,
      );
      return;
    }
    await this.consult.sync(
      documentId,
      tenantId,
      message.environment,
      'automatic',
    );
  }
}
