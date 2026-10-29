import { Injectable } from '@nestjs/common';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
} from '../../domain/connector';

const BASE_URL = 'https://api.abacatepay.com/v2';

export interface AbacatePayCustomer {
  name: string | null;
  email: string | null;
  /** Digits as AbacatePay returns them; null when the customer has none. */
  taxId: string | null;
}

/** API v2 calls made with the client's own key (CUSTOMER:READ). */
@Injectable()
export class AbacatePayClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** Lists one customer: the cheapest call that proves the key works and can read customers. */
  async checkCredentials(apiKey: string): Promise<void> {
    await this.call(apiKey, '/customers/list?limit=1');
  }

  /** The webhook masks the document; this endpoint returns it whole. */
  async getCustomer(
    apiKey: string,
    customerId: string,
  ): Promise<AbacatePayCustomer> {
    const response = await this.call(
      apiKey,
      `/customers/get?id=${encodeURIComponent(customerId)}`,
    );
    const body = (await response.json().catch(() => null)) as {
      data?: { name?: string; email?: string; taxId?: string } | null;
    } | null;
    const customer = body?.data;
    return {
      name: customer?.name ?? null,
      email: customer?.email ?? null,
      taxId: customer?.taxId ?? null,
    };
  }

  private async call(apiKey: string, path: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ConnectorTransientError('Could not reach AbacatePay');
    }
    if (response.ok) return response;
    if (response.status === 401 || response.status === 403)
      throw new ConnectorAuthError('A AbacatePay recusou a chave de API');
    if (response.status === 429 || response.status >= 500)
      throw new ConnectorTransientError(
        `AbacatePay answered ${response.status}`,
      );
    throw new ConnectorDataError(`AbacatePay answered ${response.status}`);
  }
}
