import { BadGatewayException, Logger } from '@nestjs/common';
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
export interface WooviAddress {
  zipcode: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  complement?: string;
}
export interface WooviCustomer {
  name: string;
  taxID: string;
  email: string;
  phone: string;
  /** Pix Automático requires the payer's address. */
  address: WooviAddress;
}

/** Backend-only Woovi API client. The App ID never leaves the server. */
export class WooviClient {
  private readonly logger = new Logger(WooviClient.name);

  constructor(
    private readonly config: WooviConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
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
      throw new BadGatewayException(
        `Woovi request failed (${response.status})`,
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

  /**
   * Pix Automático, journey 3 (PAYMENT_ON_APPROVAL): the payer approves the
   * mandate and pays the first charge in the same step, so the response carries
   * the QR payload and a payment link.
   */
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
      name: 'Corvo',
      correlationID: input.correlationID,
      value: input.valueCents,
      comment: input.comment.slice(0, 29),
      customer: input.customer,
      type: 'PIX_RECURRING',
      frequency: 'MONTHLY',
      pixRecurringOptions: {
        journey: 'PAYMENT_ON_APPROVAL',
        retryPolicy: 'THREE_RETRIES_7_DAYS',
      },
      // Journey 3 charges on approval, so the charge day is today (São Paulo date).
      dayGenerateCharge: `${this.saoPauloDate()}T00:00:00.000Z`,
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

  private saoPauloDate(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
    }).format(this.now());
  }
}
