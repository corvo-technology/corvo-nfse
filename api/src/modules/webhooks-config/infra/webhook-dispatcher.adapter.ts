import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WebhookEvent, WebhookEnvironment } from '../domain/webhook-event';

export class WebhookDeliveryHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`Webhook delivery failed with status ${statusCode}`);
  }
}

@Injectable()
export class WebhookDispatcherAdapter {
  sign(event: WebhookEvent, secret: string): string {
    const payload = JSON.stringify(event);
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  async send(
    url: string,
    event: WebhookEvent,
    signature: string,
    environment?: WebhookEnvironment,
  ): Promise<{ statusCode: number }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Corvo-Signature': `sha256=${signature}`,
        'X-Corvo-Environment': environment ?? event.environment,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new WebhookDeliveryHttpError(res.status);
    }
    return { statusCode: res.status };
  }
}
