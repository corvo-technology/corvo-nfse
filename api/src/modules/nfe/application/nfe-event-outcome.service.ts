import { Injectable } from '@nestjs/common';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import type { NewOutboxMessage } from '@/modules/invoice/domain/outbox-message';
import type { NfeDocument } from '../domain/nfe-document';
import { CANCEL_TP_EVENTO, type NfeFiscalEvent } from '../domain/nfe-event';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import { cancellationHint, prepareDocumentsMessage } from './nfe-messages';
import { keyOf } from './nfe-outcome.service';
import {
  NfeTransitionService,
  documentTypeOf,
  nfeEventName,
} from './nfe-transition.service';

/** What the SEFAZ said about an event that it registered. */
export interface RegisteredEvent {
  protocol: string | null;
  procXml: string | null;
  cStat: string;
  xMotivo: string | null;
}

const isCancel = (event: NfeFiscalEvent) => event.tpEvento === CANCEL_TP_EVENTO;

/**
 * Turns what the SEFAZ answered about a cancellation or a correction letter into the next state
 * of the event (and of the document, for a cancellation). The event moves only from the state the
 * caller expects, so a redelivered message or a reconciliation that races the sender settles it
 * once, and the webhook goes out once.
 */
@Injectable()
export class NfeEventOutcomeService {
  constructor(
    private readonly transitions: NfeTransitionService,
    private readonly events: TypeormNfeEvents,
    private readonly webhooks: FiscalWebhookPublisher,
  ) {}

  /** The SEFAZ registered it (135/136). A cancellation ends the NF-e `cancelled`, with no refund. */
  async registered(
    event: NfeFiscalEvent,
    doc: NfeDocument,
    receipt: RegisteredEvent,
  ): Promise<void> {
    const patch = {
      protocol: receipt.protocol,
      procXml: receipt.procXml,
      cStat: receipt.cStat,
      xMotivo: receipt.xMotivo,
    };
    const from = ['pending', 'pending_check'] as const;
    // The XML of the event, and the DANFE marked after a cancellation, are stored by the worker.
    const messages = [prepareDocumentsMessage(doc, event.id)];
    if (isCancel(event)) {
      const result = await this.transitions.apply(keyOf(doc), 'cancelled', {
        from: ['cancelling'],
        info: { cStat: receipt.cStat, xMotivo: receipt.xMotivo },
        messages,
        change: async (locked) => {
          await this.events.settle(
            event.id,
            event.tenantId,
            [...from],
            'registered',
            patch,
          );
          // A refused try before this one leaves nothing behind.
          locked.clearError();
        },
      });
      // The document had already moved (another path settled it): the event still has to close.
      if (!result.applied)
        await this.events.settle(
          event.id,
          event.tenantId,
          [...from],
          'registered',
          patch,
        );
      return;
    }
    let applied = false;
    await this.transitions.touch(keyOf(doc), {
      change: async () => {
        applied = await this.events.settle(
          event.id,
          event.tenantId,
          [...from],
          'registered',
          patch,
        );
      },
      messages,
    });
    if (applied)
      await this.webhooks.publish(
        {
          type: documentTypeOf(doc.toSnapshot().model),
          id: doc.id,
          tenantId: doc.tenantId,
          environment: doc.environment,
          companyId: doc.companyId,
        },
        'nfe.document.corrected',
        {
          eventId: event.id,
          nSeq: event.nSeq,
          protocol: receipt.protocol,
          cStat: receipt.cStat,
          xMotivo: receipt.xMotivo,
          accessKey: doc.toSnapshot().accessKey,
        },
      );
  }

  /**
   * The SEFAZ refused it (the reason as it came). A refused cancellation puts the NF-e back to
   * `authorized` and says `cancellation_rejected`, not `authorized` again.
   */
  async rejected(
    event: NfeFiscalEvent,
    doc: NfeDocument,
    cStat: string,
    xMotivo: string,
  ): Promise<void> {
    const patch = { cStat, xMotivo };
    const from = ['pending', 'pending_check'] as const;
    if (isCancel(event)) {
      const model = doc.toSnapshot().model;
      const hint = cancellationHint(model, cStat);
      const result = await this.transitions.apply(keyOf(doc), 'authorized', {
        from: ['cancelling'],
        change: async (locked) => {
          await this.events.settle(
            event.id,
            event.tenantId,
            [...from],
            'rejected',
            patch,
          );
          // The NFC-e keeps the reason where the customer looks (`lastError`, with the hint).
          if (model === 65)
            locked.recordError({
              type: 'validation',
              code: cStat,
              message: xMotivo,
            });
        },
        webhook: {
          type: nfeEventName(model, 'document.cancellation_rejected'),
          data: {
            eventId: event.id,
            cStat,
            xMotivo,
            ...(hint ? { hint } : {}),
          },
        },
      });
      if (!result.applied)
        await this.events.settle(
          event.id,
          event.tenantId,
          [...from],
          'rejected',
          patch,
        );
      return;
    }
    await this.transitions.touch(keyOf(doc), {
      change: async () => {
        await this.events.settle(
          event.id,
          event.tenantId,
          [...from],
          'rejected',
          patch,
        );
      },
    });
  }

  /** No answer: the event waits for a look at the SEFAZ by the key. */
  async pendingCheck(
    event: NfeFiscalEvent,
    doc: NfeDocument,
    message: NewOutboxMessage,
  ): Promise<void> {
    await this.transitions.touch(keyOf(doc), {
      change: async () => {
        await this.events.settle(
          event.id,
          event.tenantId,
          ['pending'],
          'pending_check',
        );
      },
      messages: [message],
    });
  }

  /** The SEFAZ does not have the event: the same signed request goes out again. */
  async backToPending(
    event: NfeFiscalEvent,
    doc: NfeDocument,
    message: NewOutboxMessage,
  ): Promise<void> {
    await this.transitions.touch(keyOf(doc), {
      change: async () => {
        await this.events.settle(
          event.id,
          event.tenantId,
          ['pending_check'],
          'pending',
        );
      },
      messages: [message],
    });
  }

  /** Puts a send or a look off without changing the event. */
  async later(doc: NfeDocument, message: NewOutboxMessage): Promise<void> {
    await this.transitions.touch(keyOf(doc), { messages: [message] });
  }
}
