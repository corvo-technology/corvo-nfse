import { Injectable, Logger } from '@nestjs/common';
import {
  SimplesRegistryPort,
  type CnpjProfile,
  type RegistryInfo,
} from '@/modules/company/domain/registry-check';

type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

interface RegistryRecord {
  info: RegistryInfo;
  profile: CnpjProfile;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

function toProfile(record: Record<string, unknown>, info: RegistryInfo) {
  const kind = text(record.descricao_tipo_de_logradouro);
  const name = text(record.logradouro);
  const street =
    kind && name && !name.toUpperCase().startsWith(kind.toUpperCase())
      ? `${kind} ${name}`
      : name;
  const situation = text(record.descricao_situacao_cadastral);
  const code = record.codigo_situacao_cadastral;
  const profile: CnpjProfile = {
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
    // 2 is ATIVA in the Receita table; the text is the fallback when the code is missing.
    active: typeof code === 'number' ? code === 2 : situation === 'ATIVA',
    situation,
  };
  return profile;
}

const DAY_MS = 24 * 3600_000;
/** Oldest entries are dropped beyond this, so the cache cannot grow forever. */
const MAX_CACHED = 1000;

/** Public CNPJ registry (BrasilAPI). Free, rate limited: cached for 24 h and never blocking. */
@Injectable()
export class BrasilApiSimplesRegistry extends SimplesRegistryPort {
  private readonly logger = new Logger(BrasilApiSimplesRegistry.name);
  private readonly cache = new Map<
    string,
    { at: number; record: RegistryRecord }
  >();
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(
    options: {
      fetchFn?: FetchLike;
      now?: () => number;
      timeoutMs?: number;
    } = {},
  ) {
    super();
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  async lookup(cnpj: string): Promise<RegistryInfo | null> {
    return (await this.fetchRecord(cnpj))?.info ?? null;
  }

  async lookupProfile(cnpj: string): Promise<CnpjProfile | null> {
    return (await this.fetchRecord(cnpj))?.profile ?? null;
  }

  private async fetchRecord(cnpj: string): Promise<RegistryRecord | null> {
    // The new alphanumeric CNPJ keeps its letters: stripping them would query another company.
    const digits = cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const cached = this.cache.get(digits);
    if (cached && this.now() - cached.at < DAY_MS) return cached.record;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(
        `https://brasilapi.com.br/api/cnpj/v1/${digits}`,
        { signal: controller.signal },
      );
      if (!response.ok) return null;
      const body = await response.json();
      if (typeof body !== 'object' || body === null) return null;
      const record = body as Record<string, unknown>;
      const ibge = record.codigo_municipio_ibge;
      const info: RegistryInfo = {
        optanteSimples:
          typeof record.opcao_pelo_simples === 'boolean'
            ? record.opcao_pelo_simples
            : null,
        optanteMei:
          typeof record.opcao_pelo_mei === 'boolean'
            ? record.opcao_pelo_mei
            : null,
        municipalityCode:
          typeof ibge === 'number' ? String(ibge).padStart(7, '0') : null,
      };
      const entry: RegistryRecord = { info, profile: toProfile(record, info) };
      if (this.cache.size >= MAX_CACHED)
        this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(digits, { at: this.now(), record: entry });
      return entry;
    } catch (error) {
      this.logger.warn(`CNPJ registry lookup failed: ${String(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
