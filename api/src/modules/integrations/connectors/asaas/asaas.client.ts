import { Injectable } from '@nestjs/common';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
  type CustomerAddress,
  type IntegrationEnvironment,
} from '../../domain/connector';

const BASE_URLS: Record<IntegrationEnvironment, string> = {
  live: 'https://api.asaas.com/v3',
  test: 'https://api-sandbox.asaas.com/v3',
};

export interface AsaasCustomer {
  name: string | null;
  email: string | null;
  /** As Asaas returns it; null when the customer has none. */
  cpfCnpj: string | null;
  address: CustomerAddress;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Only what the invoice accepts: both city and state, or neither; a 2-letter state; an 8-digit zip. */
function toAddress(body: Record<string, unknown>): CustomerAddress {
  const street = [
    text(body.address),
    text(body.addressNumber),
    text(body.complement),
    text(body.province),
  ]
    .filter(Boolean)
    .join(', ')
    .slice(0, 255);
  const city = text(body.cityName)?.slice(0, 60);
  const state = text(body.state);
  const zip = text(body.postalCode)?.replaceAll(/\D/g, '');
  const hasPlace = Boolean(city) && state?.length === 2;
  return {
    ...(street ? { street } : {}),
    ...(hasPlace ? { city, state: state.toUpperCase() } : {}),
    ...(zip?.length === 8 ? { zip } : {}),
  };
}

/** Read-only calls to the Asaas API made with the client's own key (header `access_token`). Plain fetch. */
@Injectable()
export class AsaasClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** Lists one customer: the cheapest call that proves the key works and can read customers. */
  async checkCredentials(
    accessToken: string,
    environment: IntegrationEnvironment,
  ): Promise<void> {
    await this.getJson(accessToken, environment, '/customers?limit=1');
  }

  /** The payment only names its customer; name, document, e-mail and address come from here. */
  async getCustomer(
    accessToken: string,
    environment: IntegrationEnvironment,
    customerId: string,
  ): Promise<AsaasCustomer> {
    const body = await this.getJson(
      accessToken,
      environment,
      `/customers/${encodeURIComponent(customerId)}`,
    );
    return {
      name: text(body.name),
      email: text(body.email),
      cpfCnpj: text(body.cpfCnpj),
      address: toAddress(body),
    };
  }

  private async getJson(
    accessToken: string,
    environment: IntegrationEnvironment,
    path: string,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchFn(`${BASE_URLS[environment]}${path}`, {
        // Asaas refuses calls without a User-Agent.
        headers: { access_token: accessToken, 'User-Agent': 'Corvo' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ConnectorTransientError('Could not reach Asaas');
    }
    if (response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    }
    if (response.status === 401 || response.status === 403)
      throw new ConnectorAuthError('O Asaas recusou a chave de API');
    if (response.status === 429 || response.status >= 500)
      throw new ConnectorTransientError(`Asaas answered ${response.status}`);
    throw new ConnectorDataError(`Asaas answered ${response.status}`);
  }
}
