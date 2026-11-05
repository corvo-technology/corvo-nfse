import type { WooviConfig } from '@/infra/config/configuration.types';

export interface WooviCharge {
  correlationID: string;
  brCode: string;
  qrCodeImage: string;
  paymentLinkUrl: string;
}
export interface WooviSubscription {
  correlationID: string;
  status: string;
  paymentLinkUrl: string;
}
export interface WooviCustomer {
  name: string;
  taxID: string;
  email?: string;
  phone?: string;
}

/** Backend-only Woovi API client. The App ID never leaves the server. */
export class WooviClient {
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
    if (!response.ok)
      throw new Error(`Woovi request failed (${response.status})`);
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

  async createSubscription(input: {
    correlationID: string;
    valueCents: number;
    comment: string;
    customer: WooviCustomer;
  }): Promise<WooviSubscription> {
    const { subscription } = await this.call<{
      subscription: WooviSubscription;
    }>('POST', '/subscriptions', {
      correlationID: input.correlationID,
      value: input.valueCents,
      comment: input.comment,
      interval: 'MONTHLY',
      customer: input.customer,
    });
    return subscription;
  }

  async cancelSubscription(correlationID: string): Promise<void> {
    await this.call(
      'DELETE',
      `/subscriptions/${encodeURIComponent(correlationID)}`,
    );
  }
}
