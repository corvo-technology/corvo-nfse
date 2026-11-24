import { Injectable } from '@nestjs/common';
import {
  CustomerRegistryPort,
  type CustomerRegistryInfo,
} from '@/modules/invoice/domain/customer-registry';
import {
  BrasilApiCnpjClient,
  sharedBrasilApiClient,
  type BrasilApiClientOptions,
} from './brasilapi-cnpj-client';

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Name, city and state of a CNPJ to prefill a new customer, read from the shared public CNPJ registry client. */
@Injectable()
export class BrasilApiCustomerRegistry extends CustomerRegistryPort {
  private readonly client: BrasilApiCnpjClient;

  constructor(
    options: BrasilApiClientOptions & { client?: BrasilApiCnpjClient } = {},
  ) {
    super();
    const { client, ...clientOptions } = options;
    this.client =
      client ??
      (Object.keys(clientOptions).length > 0
        ? new BrasilApiCnpjClient(clientOptions)
        : sharedBrasilApiClient);
  }

  async lookup(cnpj: string): Promise<CustomerRegistryInfo | null> {
    const record = await this.client.fetch(cnpj);
    if (!record) return null;
    const name = text(record.razao_social) ?? text(record.nome_fantasia);
    if (!name) return null;
    const uf = text(record.uf)?.toUpperCase() ?? null;
    return {
      name,
      city: text(record.municipio),
      state: uf && /^[A-Z]{2}$/.test(uf) ? uf : null,
    };
  }
}
