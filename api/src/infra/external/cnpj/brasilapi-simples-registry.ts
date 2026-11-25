import { Injectable } from '@nestjs/common';
import {
  SimplesRegistryPort,
  type CnpjProfile,
  type CnpjProfileResult,
  type RegistryInfo,
} from '@/modules/company/domain/registry-check';
import {
  BrasilApiCnpjClient,
  sharedBrasilApiClient,
  type BrasilApiClientOptions,
} from './brasilapi-cnpj-client';

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

function toInfo(record: Record<string, unknown>): RegistryInfo {
  const ibge = record.codigo_municipio_ibge;
  return {
    optanteSimples:
      typeof record.opcao_pelo_simples === 'boolean'
        ? record.opcao_pelo_simples
        : null,
    optanteMei:
      typeof record.opcao_pelo_mei === 'boolean' ? record.opcao_pelo_mei : null,
    municipalityCode:
      typeof ibge === 'number' ? String(ibge).padStart(7, '0') : null,
  };
}

function toProfile(
  record: Record<string, unknown>,
  info: RegistryInfo,
): CnpjProfile {
  const kind = text(record.descricao_tipo_de_logradouro);
  const name = text(record.logradouro);
  const street =
    kind && name && !name.toUpperCase().startsWith(kind.toUpperCase())
      ? `${kind} ${name}`
      : name;
  const situation = text(record.descricao_situacao_cadastral);
  // BrasilAPI sends the code as `situacao_cadastral`; 2 is ATIVA in the Receita table.
  const code = record.situacao_cadastral ?? record.codigo_situacao_cadastral;
  return {
    legalName: text(record.razao_social),
    tradeName: text(record.nome_fantasia),
    address: {
      zip: text(record.cep).replace(/\D/g, ''),
      street,
      number: text(record.numero),
      complement: text(record.complemento),
      district: text(record.bairro),
      city: text(record.municipio),
      state: text(record.uf).toUpperCase(),
    },
    municipalityCode: info.municipalityCode,
    simples: info.optanteSimples,
    mei: info.optanteMei,
    // The text is the fallback when the code is missing.
    active: typeof code === 'number' ? code === 2 : situation === 'ATIVA',
    situation,
  };
}

/** Simples/MEI check and company profile, both read from the shared public CNPJ registry client. */
@Injectable()
export class BrasilApiSimplesRegistry extends SimplesRegistryPort {
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

  async lookup(cnpj: string): Promise<RegistryInfo | null> {
    const record = await this.client.fetch(cnpj);
    return record ? toInfo(record) : null;
  }

  async lookupProfile(cnpj: string): Promise<CnpjProfileResult> {
    const result = await this.client.fetchResult(cnpj);
    if (result.status !== 'found') return result;
    return {
      status: 'found',
      profile: toProfile(result.record, toInfo(result.record)),
    };
  }
}
