import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { MillionSendEmailProvider } from '@/infra/external/email/mmsend-email.provider';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import type { RenderedEmail } from '@/infra/external/email/email-templates';
import type { EmailJobData } from './email-job.types';
import { WebhookEvent } from '@/modules/webhooks-config/domain/webhook-event';

/** Hides the address in logs: only the first letter and the domain stay (j***@gmail.com). */
export function maskEmail(to: string): string {
  const at = to.lastIndexOf('@');
  if (at < 1) return '***';
  return `${to[0]}***${to.slice(at)}`;
}

@Processor('email')
@Injectable()
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly provider: MillionSendEmailProvider,
    private readonly outboxService: WebhookOutboxService,
    private readonly webhookConfigRepo: IWebhookConfigRepository,
  ) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    const { data } = job;

    this.logger.debug(
      `Processing email job ${data.kind} → ${maskEmail(data.to)}`,
    );

    try {
      const message: Pick<RenderedEmail, 'subject' | 'html'> &
        Partial<Pick<RenderedEmail, 'text'>> =
        'email' in data ? data.email : data;
      const { subject, html, text } = message;

      const result = await this.provider.send({
        to: [data.to],
        subject,
        html,
        ...(text ? { text } : {}),
      });

      this.logger.log(
        `Email ${data.kind} sent: ${result.id} → ${maskEmail(data.to)}`,
      );
    } catch (err) {
      this.logger.error(
        `Email ${data.kind} failed for ${maskEmail(data.to)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err; // let BullMQ handle retries
    }
  }

  async failed(job: Job<EmailJobData>): Promise<void> {
    const { data } = job;
    const attempts = job.attemptsMade ?? 0;

    this.logger.warn(
      `Email job ${data.emailId} (${data.kind}) permanently failed after ${attempts} attempts`,
    );

    if (data.kind !== 'invoice') {
      // otp and magic-link: silent discard
      return;
    }

    // invoice: emit webhook outbox
    const invoiceData = data;
    await this.emitWebhook(
      invoiceData.tenantId,
      'email.failed',
      {
        emailId: invoiceData.emailId,
        to: invoiceData.to,
        error: `Failed after ${attempts} attempts`,
        attempts,
      },
      invoiceData.apiKeyEnvironment,
    );
  }

  private async emitWebhook(
    tenantId: string,
    eventType: string,
    data: Record<string, unknown>,
    environment: 'live' | 'test' = 'live',
  ): Promise<void> {
    try {
      const configs = await this.webhookConfigRepo.findByTenantIdAndEvent(
        tenantId,
        eventType,
        environment,
      );

      for (const config of configs) {
        if (!config.active) continue;

        const event: WebhookEvent = {
          id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          type: eventType as WebhookEvent['type'],
          environment,
          createdAt: new Date().toISOString(),
          data,
        };

        await this.outboxService.enqueue({
          tenantId,
          webhookConfigId: config.id,
          eventType,
          environment,
          url: config.url,
          payload: event,
          secret: config.secret,
        });

        this.logger.log(
          `email.failed webhook enqueued to ${config.url} (env: ${environment})`,
        );
      }
    } catch (e: unknown) {
      this.logger.error(
        `Failed to emit email.failed webhook: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
