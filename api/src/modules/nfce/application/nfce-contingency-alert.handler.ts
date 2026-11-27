import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import { keyOf } from '@/modules/nfe/application/nfe-outcome.service';
import { NfeTransitionService } from '@/modules/nfe/application/nfe-transition.service';
import { INfeDocumentRepository } from '@/modules/nfe/domain/nfe-document.repository';
import {
  NFCE_CONTINGENCY_ALERT,
  type NfeMessagePayload,
} from '@/modules/nfe/domain/nfe-message-types';
import type { NfeStatus } from '@/modules/nfe/domain/nfe-status';
import { accountNotice } from '@/shared/events/account-notice.events';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import {
  NFCE_CONTINGENCY_ALERT_AFTER_MS,
  NFCE_CONTINGENCY_DEADLINE_MS,
} from '../domain/contingency';

/** The note is still on its way to the SEFAZ: the warning makes sense. Anything else already has an answer. */
const WAITING = new Set<NfeStatus>([
  'contingency_pending',
  'processing',
  'retry_pending',
  'reconciliation_required',
  'manual_review',
]);

/**
 * `nfce.contingency_alert`, due 20 hours after the off-line NFC-e was issued: if it was not
 * transmitted by then, the customer is warned once, by webhook (`nfce.contingency.deadline_near`)
 * and, for a live note, by e-mail to the account owner. The transmission itself keeps trying: after
 * 24 hours the SEFAZ still takes the note and answers cStat 150.
 */
@Injectable()
export class NfceContingencyAlertHandler
  implements OutboxHandler, OnModuleInit
{
  readonly type = NFCE_CONTINGENCY_ALERT;
  private readonly logger = new Logger(NfceContingencyAlertHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly transitions: NfeTransitionService,
    private readonly webhooks: FiscalWebhookPublisher,
    @Optional() private readonly eventBus?: ApplicationEventBus,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { documentId, tenantId } =
      message.payload as unknown as NfeMessagePayload;
    await this.process(documentId, tenantId, message.environment);
  }

  /** `now` is injectable so the 20 h edge can be tested. */
  async process(
    documentId: string,
    tenantId: string,
    environment: 'test' | 'live',
    now: Date = new Date(),
  ): Promise<void> {
    const doc = await this.documents.findById(
      documentId,
      tenantId,
      environment,
    );
    if (!doc) return;
    const s = doc.toSnapshot();
    if (s.tpEmis !== 9 || !s.contingencyAt || s.contingencyAlertedAt) return;
    if (!WAITING.has(s.status)) return;
    const alertAt = s.contingencyAt.getTime() + NFCE_CONTINGENCY_ALERT_AFTER_MS;
    // Delivered early (a clock apart): let the outbox bring it back, never warn before 20 hours.
    if (now.getTime() < alertAt)
      throw new Error('The 20 hour mark of the off-line NFC-e was not reached');

    let won = false;
    await this.transitions.touch(keyOf(doc), {
      change: (locked) => {
        if (locked.toSnapshot().contingencyAlertedAt) return;
        locked.markContingencyAlerted(now);
        won = true;
      },
    });
    if (!won) return;

    const deadlineAt = new Date(
      s.contingencyAt.getTime() + NFCE_CONTINGENCY_DEADLINE_MS,
    );
    await this.webhooks.publish(
      {
        type: 'nfce',
        id: s.id,
        tenantId: s.tenantId,
        environment: s.environment,
        companyId: s.companyId,
      },
      'nfce.contingency.deadline_near',
      {
        status: s.status,
        accessKey: s.accessKey,
        number: s.number,
        series: s.series,
        externalId: s.externalId,
        contingencyAt: s.contingencyAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
      },
    );
    // E-mails are for live activity only, like every other account notice.
    if (s.environment === 'live')
      this.eventBus?.publishBestEffort(
        accountNotice(s.tenantId, {
          kind: 'nfce-contingency-deadline',
          documentId: s.id,
          number: s.number,
          deadlineAt,
        }),
      );
    this.logger.warn(
      { documentId: s.id, accessKey: s.accessKey },
      'Off-line NFC-e is 20 hours old and was not transmitted',
    );
  }
}
