export abstract class WebhookSecrets {
  abstract findSecret(
    tenantId: string,
    webhookConfigId: string,
  ): Promise<string>;
}

export const WEBHOOK_SECRETS = Symbol('WebhookSecrets');
