import { Injectable } from '@nestjs/common';
import { WebhookSecrets } from '../domain/webhook-secrets.port';
import { IWebhookConfigRepository } from '../domain/webhook-config.repository';

@Injectable()
export class EnvWebhookSecrets implements WebhookSecrets {
  constructor(private readonly webhookConfigRepo: IWebhookConfigRepository) {}

  async findSecret(tenantId: string, webhookConfigId: string): Promise<string> {
    const config = await this.webhookConfigRepo.findByIdAndTenantId(
      webhookConfigId,
      tenantId,
    );

    if (!config) {
      throw new Error(`Webhook config ${webhookConfigId} not found`);
    }

    return config.secret;
  }
}
