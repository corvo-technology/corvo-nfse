import { Injectable, Logger } from '@nestjs/common';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import type { WebhookEvent } from '@/modules/webhooks-config/domain/webhook-event';
import type { Invoice } from '../domain/invoice';
import { buildInvoiceState, type InvoiceState } from '../domain/invoice-state';

/** Best-effort tenant webhooks for invoice lifecycle events. */
@Injectable()
export class InvoiceWebhookPublisher {
  private readonly logger = new Logger(InvoiceWebhookPublisher.name);

  constructor(
    private readonly webhooks: IWebhookConfigRepository,
    private readonly outbox: WebhookOutboxService,
  ) {}

  async publish(
    invoice: Invoice,
    type: WebhookEvent['type'],
    extra: Record<string, unknown> = {},
    stateOverride: Partial<Pick<InvoiceState, 'emailStatus'>> = {},
  ): Promise<void> {
    try {
      const configs = await this.webhooks.findByTenantIdAndEvent(
        invoice.tenantId,
        type,
        invoice.environment,
      );
      const event: WebhookEvent = {
        id: `evt_${crypto.randomUUID()}`,
        type,
        environment: invoice.environment,
        createdAt: new Date().toISOString(),
        data: {
          invoiceId: invoice.id,
          companyId: invoice.companyId,
          environment: invoice.environment,
          ...this.stateOf(invoice, stateOverride),
          ...extra,
        },
      };
      for (const config of configs)
        if (config.active)
          await this.outbox.enqueue({
            tenantId: invoice.tenantId,
            webhookConfigId: config.id,
            eventType: type,
            environment: invoice.environment,
            url: config.url,
            payload: event,
            secret: config.secret,
          });
    } catch (error: unknown) {
      this.logger.error(
        { err: error, invoiceId: invoice.id },
        'Fiscal webhook enqueue failed',
      );
    }
  }

  /** Current fiscal/documents/email state; the event itself may be newer than the loaded invoice. */
  private stateOf(
    invoice: Invoice,
    override: Partial<Pick<InvoiceState, 'emailStatus'>>,
  ): InvoiceState {
    return buildInvoiceState({
      status: invoice.status,
      documentsReady: invoice.documentsReadyAt !== null,
      emailRequested: Boolean(invoice.emailSnapshot?.send),
      emailStatus: override.emailStatus ?? invoice.lastEmailStatus,
    });
  }
}
