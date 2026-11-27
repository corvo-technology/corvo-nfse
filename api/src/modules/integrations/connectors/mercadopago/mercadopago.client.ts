import { Injectable } from '@nestjs/common';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
} from '../../domain/connector';

const BASE_URL = 'https://api.mercadopago.com';

/** Read-only calls to the Mercado Pago API made with the client's own Access Token. Plain fetch, no SDK. */
@Injectable()
export class MercadoPagoClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** The seller account the token belongs to: proves the token works and names the account. */
  async getUserId(accessToken: string): Promise<string> {
    const body = await this.getJson<{ id?: unknown }>(accessToken, '/users/me');
    const id = body?.id;
    if (
      (typeof id !== 'number' && typeof id !== 'string') ||
      String(id).length === 0
    )
      throw new ConnectorDataError(
        'Mercado Pago did not return the account id',
      );
    return String(id);
  }

  /** The payment as Mercado Pago holds it (the webhook only carries its id). */
  async getPayment(
    accessToken: string,
    paymentId: string,
  ): Promise<Record<string, unknown>> {
    const body = await this.getJson<Record<string, unknown>>(
      accessToken,
      `/v1/payments/${encodeURIComponent(paymentId)}`,
      true,
    );
    if (!body || typeof body !== 'object')
      throw new ConnectorDataError('Mercado Pago returned no payment');
    return body;
  }

  /** A 404 on a payment can be the notice arriving before the payment is readable: retry. */
  private async getJson<T>(
    accessToken: string,
    path: string,
    retryNotFound = false,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetchFn(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ConnectorTransientError('Could not reach Mercado Pago');
    }
    if (response.ok)
      return (await response.json().catch(() => null)) as T | null;
    if (response.status === 401 || response.status === 403)
      throw new ConnectorAuthError('O Mercado Pago recusou o Access Token');
    if (
      response.status === 429 ||
      response.status >= 500 ||
      (retryNotFound && response.status === 404)
    )
      throw new ConnectorTransientError(
        `Mercado Pago answered ${response.status}`,
      );
    throw new ConnectorDataError(`Mercado Pago answered ${response.status}`);
  }
}
