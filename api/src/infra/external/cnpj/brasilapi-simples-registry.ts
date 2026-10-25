import { Injectable, Logger } from '@nestjs/common';
import {
  SimplesRegistryPort,
  type RegistryInfo,
} from '@/modules/company/domain/registry-check';

type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const DAY_MS = 24 * 3600_000;
/** Oldest entries are dropped beyond this, so the cache cannot grow forever. */
const MAX_CACHED = 1000;

/** Public CNPJ registry (BrasilAPI). Free, rate limited: cached for 24 h and never blocking. */
@Injectable()
export class BrasilApiSimplesRegistry extends SimplesRegistryPort {
  private readonly logger = new Logger(BrasilApiSimplesRegistry.name);
  private readonly cache = new Map<
    string,
    { at: number; info: RegistryInfo }
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
    this.fetchFn = options.fetchFn ?? (fetch as unknown as FetchLike);
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  async lookup(cnpj: string): Promise<RegistryInfo | null> {
    // The new alphanumeric CNPJ keeps its letters: stripping them would query another company.
    const digits = cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const cached = this.cache.get(digits);
    if (cached && this.now() - cached.at < DAY_MS) return cached.info;
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
      if (this.cache.size >= MAX_CACHED)
        this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(digits, { at: this.now(), info });
      return info;
    } catch (error) {
      this.logger.warn(`CNPJ registry lookup failed: ${String(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
