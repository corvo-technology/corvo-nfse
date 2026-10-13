import { Injectable, Logger } from '@nestjs/common';
import { WebhookConfigService } from './webhook-config.service';
import { WebhookEvent, WebhookEnvironment } from '../domain/webhook-event';
import { WebhookOutboxService } from './webhook-outbox.service';

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
    const webhooks = await this.configService.findByEvent(tenantId, event.type);

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

  async test(tenantId: string, id: string): Promise<void> {
    const webhook = await this.configService.findOne(tenantId, id);
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

    await this.outboxService.attemptDelivery(
      delivery,
      testEvent,
      webhook.secret,
      false,
    );
  }
}
