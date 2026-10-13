/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import {
  WebhookEvent,
  WebhookEventType,
  WebhookEnvironment,
} from '../domain/webhook-event';

@Injectable()
export class WebhookEventEmitter {
  private readonly logger = new Logger(WebhookEventEmitter.name);

  constructor(private readonly dispatcher: WebhookDispatcherService) {}

  async emit(params: {
    tenantId: string;
    type: WebhookEventType;
    environment: WebhookEnvironment;
    data: Record<string, unknown>;
  }): Promise<void> {
    const event: WebhookEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      type: params.type,
      environment: params.environment,
      createdAt: new Date().toISOString(),
      data: params.data,
    };

    try {
      await this.dispatcher.dispatch(params.tenantId, event);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to emit webhook event ${params.type}: ${(error as any).message}`,
      );
    }
  }
}
