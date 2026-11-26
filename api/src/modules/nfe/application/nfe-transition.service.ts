import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { creditsUsageChanged } from '@/modules/billing/application/credits-usage.events';
import { BillingRepository } from '@/modules/billing/domain/billing.repository';
import { DocumentCreditLedger } from '@/modules/fiscal-core/application/document-credit-ledger';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import { OutboxService } from '@/modules/invoice/application/outbox.service';
import type { NewOutboxMessage } from '@/modules/invoice/domain/outbox-message';
import type { WebhookEvent } from '@/modules/webhooks-config/domain/webhook-event';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import type { NfeDocument, NfeTransitionInfo } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import type { NfeStatus } from '../domain/nfe-status';

export interface NfeKey {
  id: string;
  tenantId: string;
  environment: ExecutionEnvironment;
}

export interface NfeTransitionOptions {
  /** cStat / xMotivo recorded on the document and on its history row. */
  info?: NfeTransitionInfo;
  /**
   * Applied to the document read under the row lock, before the state moves: numbering, key and
   * signed XML (write-ahead), the authorization data, the last error, the next check.
   */
  change?: (document: NfeDocument) => void | Promise<void>;
  /** Outbox messages that commit together with the state. */
  messages?: NewOutboxMessage[];
  /** Only apply when the stored state is one of these; otherwise nothing happens. */
  from?: NfeStatus[];
  /**
   * Replaces the webhook the destination state would send (`null`: none). A rejected cancellation
   * goes back to `authorized` without saying "authorized" again.
   */
  webhook?: {
    type: WebhookEvent['type'];
    data?: Record<string, unknown>;
  } | null;
}

export interface NfeTransitionResult {
  /** False when the stored state was already the destination (or not an allowed origin). */
  applied: boolean;
  document: NfeDocument;
}

/**
 * The webhook type of a document of this model: `nfe.<suffix>` for the NF-e (55) and `nfce.<suffix>`
 * for the NFC-e (65). `suffix` is what follows the prefix (`document.authorized`...).
 */
export function nfeEventName(
  model: 55 | 65,
  suffix: string,
): WebhookEvent['type'] {
  return `${model === 65 ? 'nfce' : 'nfe'}.${suffix}` as WebhookEvent['type'];
}

/** The document type that credits, webhooks and the fiscal gateway registry use for a model. */
export const documentTypeOf = (model: 55 | 65): 'nfe' | 'nfce' =>
  model === 65 ? 'nfce' : 'nfe';

/** The gateway of a model in the `FiscalDocumentRegistry`. */
export const gatewayTypeOf = documentTypeOf;

/** Webhook sent after the commit, by destination state (the suffix after `nfe.` / `nfce.`). */
const WEBHOOK_BY_STATUS: Partial<Record<NfeStatus, string>> = {
  authorized: 'document.authorized',
  rejected: 'document.rejected',
  denied: 'document.denied',
  reconciliation_required: 'document.reconciliation_required',
  manual_review: 'document.manual_review',
  cancelled: 'document.cancelled',
};

/**
 * Every state change of an NF-e goes through here: one transaction, under the tenant's billing
 * lock and the row lock, writing the document, its history row, the outbox messages and the
 * credit effect together. A change to the state the row already has does nothing, and that is the
 * latch that makes "authorized" fire once even if the worker and a reconciliation race.
 */
@Injectable()
export class NfeTransitionService {
  private readonly logger = new Logger(NfeTransitionService.name);

  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly billing: BillingRepository,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly ledger: DocumentCreditLedger,
    private readonly outbox: OutboxService,
    private readonly webhooks: FiscalWebhookPublisher,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Optional() private readonly eventBus?: ApplicationEventBus,
  ) {}

  async apply(
    key: NfeKey,
    to: NfeStatus,
    options: NfeTransitionOptions = {},
  ): Promise<NfeTransitionResult> {
    const result = await runWithTenant(key.tenantId, () =>
      this.unitOfWork.execute(() =>
        this.billing.locked(key.tenantId, () => this.within(key, to, options)),
      ),
    );
    if (!result.applied) return result;
    await this.afterCommit(result.document, to, options.webhook);
    return result;
  }

  /**
   * Changes the document without moving its state (the next check, the attempt counter...), under
   * the same locks. Returns the stored document.
   */
  async touch(
    key: NfeKey,
    options: Pick<NfeTransitionOptions, 'change' | 'messages'>,
  ): Promise<NfeDocument> {
    return runWithTenant(key.tenantId, () =>
      this.unitOfWork.execute(() =>
        this.billing.locked(key.tenantId, async () => {
          const document = await this.documents.findById(
            key.id,
            key.tenantId,
            key.environment,
            { forUpdate: true },
          );
          if (!document) throw new Error('NF-e not found');
          await options.change?.(document);
          await this.documents.save(document);
          for (const message of options.messages ?? [])
            await this.outbox.enqueue(message);
          return document;
        }),
      ),
    );
  }

  private async within(
    key: NfeKey,
    to: NfeStatus,
    options: NfeTransitionOptions,
  ): Promise<NfeTransitionResult> {
    const document = await this.documents.findById(
      key.id,
      key.tenantId,
      key.environment,
      { forUpdate: true },
    );
    if (!document) throw new Error('NF-e not found');
    const from = document.status;
    if (from === to || (options.from && !options.from.includes(from)))
      return { applied: false, document };
    await options.change?.(document);
    const entry = document.transitionTo(to, options.info);
    await this.documents.save(document);
    await this.documents.appendHistory(entry);
    for (const message of options.messages ?? [])
      await this.outbox.enqueue(message);
    await this.ledger.settle(
      {
        type: documentTypeOf(document.toSnapshot().model),
        id: document.id,
        tenantId: document.tenantId,
        environment: document.environment,
      },
      from,
      to,
    );
    return { applied: true, document };
  }

  /** Cache, usage event and webhook: none of them may undo or fail a fiscal fact. */
  private async afterCommit(
    document: NfeDocument,
    to: NfeStatus,
    override?: NfeTransitionOptions['webhook'],
  ) {
    const { tenantId, environment } = document;
    if (environment === 'live') {
      try {
        await this.cache.delete(`credit:balance:${tenantId}`);
      } catch (error) {
        this.logger.warn(
          `Could not invalidate the credit balance cache: ${String(error)}`,
        );
      }
      this.eventBus?.publishBestEffort(creditsUsageChanged(tenantId));
    }
    const s = document.toSnapshot();
    const suffix = WEBHOOK_BY_STATUS[to];
    const type =
      override === undefined
        ? suffix && nfeEventName(s.model, suffix)
        : override?.type;
    if (!type) return;
    await this.webhooks.publish(
      {
        type: documentTypeOf(s.model),
        id: s.id,
        tenantId: s.tenantId,
        environment: s.environment,
        companyId: s.companyId,
      },
      type,
      {
        status: s.status,
        accessKey: s.accessKey,
        number: s.number,
        series: s.series,
        protocol: s.protocol,
        cStat: s.cStat,
        xMotivo: s.xMotivo,
        externalId: s.externalId,
        ...(override?.data ?? {}),
      },
    );
  }
}
