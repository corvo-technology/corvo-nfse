import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { IWebhookDeliveryRepository } from '../domain/webhook-delivery.repository';
import {
  WebhookDeliveryHttpError,
  WebhookDispatcherAdapter,
} from '../infra/webhook-dispatcher.adapter';
import { WebhookDelivery } from '../domain/webhook-delivery';
import { WebhookEvent } from '../domain/webhook-event';
import { WebhookDeliveryNotFoundError } from '../domain/errors';
import {
  WEBHOOK_SECRETS,
  WebhookSecrets,
} from '../domain/webhook-secrets.port';

const RETRY_DELAYS = [0, 60_000, 160_000, 900_000, 1_800_000]; // 0s, 60s, 160s, 15min, 30min
const MAX_RETRIES = 5;
const CLAIM_LEASE_MS = 2 * 60_000; // crashed sends are retried after this

export type EnqueueWebhookInput = {
  tenantId: string;
  webhookConfigId: string;
  eventType: string;
  environment: 'live' | 'test';
  url: string;
  payload: WebhookEvent;
  secret: string;
};

@Injectable()
export class WebhookOutboxService {
  private readonly logger = new Logger(WebhookOutboxService.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly deliveryRepo: IWebhookDeliveryRepository,
    private readonly adapter: WebhookDispatcherAdapter,
    @Inject(WEBHOOK_SECRETS)
    private readonly webhookSecrets: WebhookSecrets,
  ) {}

  async enqueue(delivery: EnqueueWebhookInput): Promise<WebhookDelivery> {
    const record: WebhookDelivery = {
      id: crypto.randomUUID(),
      tenantId: delivery.tenantId,
      webhookConfigId: delivery.webhookConfigId,
      eventType: delivery.eventType,
      environment: delivery.environment,
      url: delivery.url,
      payload: delivery.payload,
      status: 'pending',
      retryCount: 0,
      nextRetryAt: new Date(),
      createdAt: new Date(),
    };
    const saved = await this.deliveryRepo.save(record, delivery.tenantId);
    this.logger.log(`Enqueued webhook delivery ${record.id}`);
    return saved;
  }

  async processNext(): Promise<void> {
    await this.discovery.visit('webhook-delivery', (tenantId) =>
      this.processTenant(tenantId),
    );
  }

  async processTenant(tenantId: string): Promise<void> {
    const now = new Date();
    const deliveries = await this.deliveryRepo.findPendingDeliveries(
      tenantId,
      now,
    );

    // Many deliveries share a few webhooks: read each secret once per run, not once per delivery.
    const secrets = new Map<string, string>();
    for (const delivery of deliveries) {
      const event = delivery.payload;
      if (!event) {
        this.logger.warn(
          `Webhook delivery ${delivery.id} has no payload, skipping`,
        );
        continue;
      }
      const claimed = await this.deliveryRepo.claimDelivery(
        delivery.id,
        delivery.tenantId,
        now,
        new Date(Date.now() + CLAIM_LEASE_MS),
      );
      if (!claimed) continue;
      let secret: string;
      try {
        const known = secrets.get(delivery.webhookConfigId);
        secret =
          known ??
          (await this.webhookSecrets.findSecret(
            delivery.tenantId,
            delivery.webhookConfigId,
          ));
        secrets.set(delivery.webhookConfigId, secret);
      } catch (error) {
        this.logger.error(
          `Could not resolve secret for delivery ${delivery.id}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        continue;
      }
      await this.attemptDelivery(delivery, event, secret);
    }
  }

  async attemptDelivery(
    delivery: WebhookDelivery,
    event: WebhookEvent,
    secret: string,
    retry: boolean = true,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const signature = this.adapter.sign(event, secret);

      const result = await this.adapter.send(
        delivery.url,
        event,
        signature,
        delivery.environment,
      );

      // Success
      await this.deliveryRepo.update(delivery.id, delivery.tenantId, {
        status: 'sent',
        statusCode: result.statusCode,
        durationMs: Date.now() - startTime,
        retryCount: delivery.retryCount,
      });
      this.logger.log(`Webhook ${delivery.id} delivered successfully`);
    } catch (error: unknown) {
      const statusCode =
        error instanceof WebhookDeliveryHttpError
          ? error.statusCode
          : undefined;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      if (!retry) {
        await this.deliveryRepo.update(delivery.id, delivery.tenantId, {
          status: 'failed',
          statusCode,
          lastError: errorMessage,
          durationMs: Date.now() - startTime,
        });
        throw error;
      }
      // Failed - schedule retry
      if (delivery.retryCount < MAX_RETRIES - 1) {
        const nextRetryDelay =
          RETRY_DELAYS[delivery.retryCount + 1] ??
          RETRY_DELAYS[RETRY_DELAYS.length - 1];
        const nextRetryAt = new Date(Date.now() + nextRetryDelay);

        await this.deliveryRepo.update(delivery.id, delivery.tenantId, {
          status: 'delayed',
          statusCode,
          retryCount: delivery.retryCount + 1,
          nextRetryAt,
          lastError: errorMessage,
          durationMs: Date.now() - startTime,
        });
        this.logger.warn(
          `Webhook ${delivery.id} failed, retry ${delivery.retryCount + 1} scheduled for ${nextRetryAt.toISOString()}`,
        );
      } else {
        // Max retries exhausted
        await this.deliveryRepo.update(delivery.id, delivery.tenantId, {
          status: 'failed',
          statusCode,
          retryCount: delivery.retryCount + 1,
          lastError: errorMessage,
          durationMs: Date.now() - startTime,
        });
        this.logger.error(
          `Webhook ${delivery.id} failed after ${MAX_RETRIES} retries`,
        );
      }
    }
  }

  async manualRetry(
    tenantId: string,
    deliveryId: string,
    keyEnvironment?: 'test' | 'live',
  ): Promise<void> {
    const delivery = await this.deliveryRepo.findByIdAndTenantId(
      deliveryId,
      tenantId,
    );
    if (
      !delivery ||
      (keyEnvironment && delivery.environment !== keyEnvironment)
    )
      throw new WebhookDeliveryNotFoundError(deliveryId);

    await this.deliveryRepo.update(deliveryId, tenantId, {
      status: 'manual_retry',
      retryCount: 0,
      nextRetryAt: new Date(),
      lastError: undefined,
    });
    this.logger.log(`Manual retry scheduled for delivery ${deliveryId}`);
  }
}
