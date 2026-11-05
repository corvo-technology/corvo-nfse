import {
  BadGatewayException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { WooviConfig } from '@/infra/config/configuration.types';

export interface WooviCharge {
  correlationID: string;
  brCode: string;
  qrCodeImage: string;
  paymentLinkUrl: string;
}
export interface WooviSubscription {
  correlationID: string;
  /** Woovi's own id (globalID): the one the cancel route takes. */
  providerId: string | null;
  paymentLinkUrl: string;
  /** Pix copy-and-paste / QR payload of the first charge (pixRecurring.emv). */
  brCode: string | null;
}
export interface WooviCustomer {
  name: string;
  taxID: string;
  email: string;
  phone: string;
}

/** Backend-only Woovi API client. The App ID never leaves the server. */
export class WooviClient {
  private readonly logger = new Logger(WooviClient.name);

  constructor(
    private readonly config: WooviConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.config.appId) throw new Error('Woovi is not configured');
    const response = await this.fetchFn(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: this.config.appId,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // The body explains what Woovi rejected; log it (never the app id) so the cause is findable.
      const detail = (await response.text().catch(() => ''))
        .split(this.config.appId)
        .join('[app-id]')
        .slice(0, 600);
      this.logger.warn({
        event: 'woovi_request_failed',
        method,
        path,
        status: response.status,
        detail,
      });
      // 401/403 mean our own credentials are wrong, and 5xx is Woovi being down: both are upstream
      // problems. Any other 4xx is Woovi rejecting what we sent (e.g. an invalid payer), and the
      // reason is useful to the person filling the form.
      if (
        response.status >= 500 ||
        response.status === 401 ||
        response.status === 403
      )
        throw new BadGatewayException(
          `Woovi request failed (${response.status})`,
        );
      throw new BadRequestException(
        `Woovi: ${this.reason(detail) || `request rejected (${response.status})`}`,
      );
    }
    return (await response.json()) as T;
  }

  async createCharge(input: {
    correlationID: string;
    valueCents: number;
    comment: string;
    expiresInSeconds: number;
  }): Promise<WooviCharge> {
    const { charge } = await this.call<{ charge: WooviCharge }>(
      'POST',
      '/charge',
      {
        correlationID: input.correlationID,
        value: input.valueCents,
        comment: input.comment,
        expiresIn: input.expiresInSeconds,
      },
    );
    return {
      correlationID: charge.correlationID,
      brCode: charge.brCode,
      qrCodeImage: charge.qrCodeImage,
      paymentLinkUrl: charge.paymentLinkUrl,
    };
  }

  /** What Woovi itself holds for this charge: the source of truth behind a webhook. */
  async getCharge(
    correlationID: string,
  ): Promise<{ status: string; value: number }> {
    const { charge } = await this.call<{
      charge: { status: string; value: number };
    }>('GET', `/charge/${encodeURIComponent(correlationID)}`);
    return { status: charge.status, value: charge.value };
  }

  /** Monthly recurring Pix: the payer opens the link (or scans the QR, when Woovi sends one) to authorize. */
  async createSubscription(input: {
    correlationID: string;
    valueCents: number;
    comment: string;
    customer: WooviCustomer;
  }): Promise<WooviSubscription> {
    const { subscription } = await this.call<{
      subscription: {
        correlationID: string;
        globalID?: string;
        paymentLinkUrl: string;
        pixRecurring?: { emv?: string };
      };
    }>('POST', '/subscriptions', {
      correlationID: input.correlationID,
      value: input.valueCents,
      interval: 'MONTHLY',
      customer: input.customer,
      comment: input.comment,
    });
    return {
      correlationID: subscription.correlationID,
      providerId: subscription.globalID ?? null,
      paymentLinkUrl: subscription.paymentLinkUrl,
      brCode: subscription.pixRecurring?.emv ?? null,
    };
  }

  async cancelSubscription(id: string): Promise<void> {
    await this.call('PUT', `/subscriptions/${encodeURIComponent(id)}/cancel`);
  }

  /** The human reason inside a Woovi error body (`error`, `message` or `errors[].message`). */
  private reason(detail: string): string {
    try {
      const body = JSON.parse(detail) as {
        error?: unknown;
        message?: unknown;
        errors?: Array<{ message?: unknown }>;
      };
      const parts = Array.isArray(body.errors)
        ? body.errors.map((e) => String(e.message ?? '')).filter(Boolean)
        : [];
      const single = body.error ?? body.message;
      if (parts.length) return parts.join('; ').slice(0, 300);
      if (typeof single === 'string') return single.slice(0, 300);
    } catch {
      /* not JSON */
    }
    return detail.slice(0, 200);
  }
}
