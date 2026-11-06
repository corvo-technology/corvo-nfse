import { Injectable, Logger } from '@nestjs/common';
import { WebhookConfigService } from './webhook-config.service';
import { WebhookEvent, WebhookEnvironment } from '../domain/webhook-event';
import { WebhookOutboxService } from './webhook-outbox.service';
import { WebhookDeliveryHttpError } from '../infra/webhook-dispatcher.adapter';

export type { WebhookEvent };

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    private readonly configService: WebhookConfigService,
    private readonly outboxService: WebhookOutboxService,
  ) {}

  async dispatch(
    tenantId: string,
    event: WebhookEvent,
    environment?: WebhookEnvironment,
  ): Promise<void> {
    const webhooks = await this.configService.findByEvent(
      tenantId,
      event.type,
      environment ?? event.environment,
    );

    for (const webhook of webhooks) {
      const deliveryEnv = environment ?? event.environment;

      const delivery = await this.outboxService.enqueue({
        tenantId,
        webhookConfigId: webhook.id,
        eventType: event.type,
        environment: deliveryEnv,
        url: webhook.url,
        payload: event,
        secret: webhook.secret,
      });

      await this.outboxService.attemptDelivery(delivery, event, webhook.secret);
    }
  }

  async test(
    tenantId: string,
    id: string,
    keyEnvironment?: 'test' | 'live',
  ): Promise<
    { sent: true } | { sent: false; statusCode: number | null; error: string }
  > {
    const webhook = await this.configService.findOne(
      tenantId,
      id,
      keyEnvironment,
    );
    const testEvent: WebhookEvent = {
      id: `evt_test_${Date.now()}`,
      type: 'webhook.test',
      environment: 'test',
      createdAt: new Date().toISOString(),
      data: { message: 'This is a test webhook event' },
    };

    const delivery = await this.outboxService.enqueue({
      tenantId,
      webhookConfigId: webhook.id,
      eventType: testEvent.type,
      environment: 'test',
      url: webhook.url,
      payload: testEvent,
      secret: webhook.secret,
    });

    try {
      await this.outboxService.attemptDelivery(
        delivery,
        testEvent,
        webhook.secret,
        false,
      );
      return { sent: true };
    } catch (error: unknown) {
      // The attempt is already stored as failed. The caller's request was fine, so
      // report what happened at their endpoint instead of answering 500.
      return {
        sent: false,
        statusCode:
          error instanceof WebhookDeliveryHttpError ? error.statusCode : null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
