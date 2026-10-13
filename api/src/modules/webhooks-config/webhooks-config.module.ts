import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditsModule } from '@/modules/credits/credits.module';
import { WebhooksConfigController } from './http/webhooks-config.controller';
import { WebhookDeliveryController } from './http/webhook-delivery.controller';
import { WebhookConfigEntity } from './infra/webhook-config.orm-entity';
import { WebhookDeliveryOrmEntity } from './infra/webhook-delivery.orm-entity';
import { TypeOrmWebhookConfigRepository } from './infra/typeorm-webhook-config.repository';
import { TypeormWebhookDeliveryRepository } from './infra/typeorm-webhook-delivery.repository';
import { WebhookConfigService } from './application/webhook-config.service';
import { WebhookDispatcherService } from './application/webhook-dispatcher.service';
import { WebhookOutboxService } from './application/webhook-outbox.service';
import { WebhookEventEmitter } from './application/webhook-event-emitter';
import { WebhookDeliveryService } from './application/webhook-delivery.service';
import { WebhookRetryScheduler } from './application/webhook-retry.scheduler';
import { IWebhookConfigRepository } from './domain/webhook-config.repository';
import { IWebhookDeliveryRepository } from './domain/webhook-delivery.repository';
import { WEBHOOK_SECRETS } from './domain/webhook-secrets.port';
import { WebhookDispatcherAdapter } from './infra/webhook-dispatcher.adapter';
import { EnvWebhookSecrets } from './infra/env-webhook-secrets';

@Module({
  imports: [
    CreditsModule,
    TypeOrmModule.forFeature([WebhookConfigEntity, WebhookDeliveryOrmEntity]),
  ],
  controllers: [WebhooksConfigController, WebhookDeliveryController],
  providers: [
    {
      provide: IWebhookConfigRepository,
      useClass: TypeOrmWebhookConfigRepository,
    },
    {
      provide: IWebhookDeliveryRepository,
      useClass: TypeormWebhookDeliveryRepository,
    },
    WebhookDispatcherAdapter,
    WebhookConfigService,
    WebhookDispatcherService,
    WebhookOutboxService,
    WebhookEventEmitter,
    WebhookDeliveryService,
    WebhookRetryScheduler,
    {
      provide: WEBHOOK_SECRETS,
      useClass: EnvWebhookSecrets,
    },
  ],
  exports: [
    WebhookConfigService,
    WebhookOutboxService,
    WebhookEventEmitter,
    IWebhookConfigRepository,
    IWebhookDeliveryRepository,
  ],
})
export class WebhooksConfigModule {}
