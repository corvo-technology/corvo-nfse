import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { WebhookValidationError } from '../domain/errors';
import { WebhookEvent, WebhookEnvironment } from '../domain/webhook-event';
import { isPrivateIp, safeLookup } from '../application/url-safety.validator';

export class WebhookDeliveryHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`Webhook delivery failed with status ${statusCode}`);
  }
}

@Injectable()
export class WebhookDispatcherAdapter {
  /** Overridable in tests; production always validates the connected address. */
  protected readonly lookup = safeLookup;

  sign(event: WebhookEvent, secret: string): string {
    const payload = JSON.stringify(event);
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Redirects are never followed (a 3xx counts as a failed delivery) and the destination address
   * is validated when the connection is made, so neither a redirect nor DNS rebinding can move
   * the request to an internal address after the URL was registered.
   */
  send(
    url: string,
    event: WebhookEvent,
    signature: string,
    environment?: WebhookEnvironment,
  ): Promise<{ statusCode: number }> {
    const target = new URL(url);
    const literalHost = target.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literalHost) && isPrivateIp(literalHost)) {
      return Promise.reject(
        new WebhookValidationError(
          'Webhook URL must not point to a private network address',
          { host: literalHost },
        ),
      );
    }

    const body = JSON.stringify(event);
    const open = target.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = open(
        target,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-Corvo-Signature': `sha256=${signature}`,
            'X-Corvo-Environment': environment ?? event.environment,
          },
          lookup: this.lookup,
          signal: AbortSignal.timeout(10_000),
        },
        (res) => {
          res.resume();
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ statusCode });
          } else {
            reject(new WebhookDeliveryHttpError(statusCode));
          }
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }
}
