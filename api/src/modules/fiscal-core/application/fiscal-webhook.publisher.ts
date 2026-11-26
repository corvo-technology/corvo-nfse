import { Injectable, Logger } from '@nestjs/common';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import type { WebhookEvent } from '@/modules/webhooks-config/domain/webhook-event';
import type { DocumentRef } from '../domain/document-type';

/**
 * Best-effort tenant webhooks for fiscal documents other than the NFS-e. Same envelope as the
 * invoice publisher (`id`, `type`, `environment`, `createdAt`, `data`); `data` carries
 * `documentType` and `documentId` instead of `invoiceId`, so the delivery is listed by document.
 */
@Injectable()
export class FiscalWebhookPublisher {
  private readonly logger = new Logger(FiscalWebhookPublisher.name);

  constructor(
    private readonly webhooks: IWebhookConfigRepository,
    private readonly outbox: WebhookOutboxService,
  ) {}

  async publish(
    ref: DocumentRef & { companyId: string },
    type: WebhookEvent['type'],
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const configs = await this.webhooks.findByTenantIdAndEvent(
        ref.tenantId,
        type,
        ref.environment,
      );
      const event: WebhookEvent = {
        id: `evt_${crypto.randomUUID()}`,
        type,
        environment: ref.environment,
        createdAt: new Date().toISOString(),
        data: {
          documentType: ref.type,
          documentId: ref.id,
          companyId: ref.companyId,
          environment: ref.environment,
          ...data,
        },
      };
      for (const config of configs)
        if (config.active)
          await this.outbox.enqueue({
            tenantId: ref.tenantId,
            webhookConfigId: config.id,
            eventType: type,
            environment: ref.environment,
            url: config.url,
            payload: event,
            secret: config.secret,
          });
    } catch (error: unknown) {
      // Never fails the fiscal operation that already happened.
      this.logger.error(
        { err: error, documentId: ref.id, type },
        'Fiscal document webhook enqueue failed',
      );
    }
  }
}
