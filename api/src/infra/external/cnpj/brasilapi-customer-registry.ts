import { Injectable, Logger } from '@nestjs/common';
import {
  CustomerRegistryPort,
  type CustomerRegistryInfo,
} from '@/modules/invoice/domain/customer-registry';

type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const DAY_MS = 24 * 3600_000;
const MAX_CACHED = 1000;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Public CNPJ registry (BrasilAPI) read for a new customer. Cached for 24 h, 3 s timeout, never throws. */
@Injectable()
export class BrasilApiCustomerRegistry extends CustomerRegistryPort {
  private readonly logger = new Logger(BrasilApiCustomerRegistry.name);
  private readonly cache = new Map<
    string,
    { at: number; info: CustomerRegistryInfo }
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

  async lookup(cnpj: string): Promise<CustomerRegistryInfo | null> {
    // The alphanumeric CNPJ keeps its letters: stripping them would query another company.
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
      const name = text(record.razao_social) ?? text(record.nome_fantasia);
      if (!name) return null;
      const uf = text(record.uf)?.toUpperCase() ?? null;
      const info: CustomerRegistryInfo = {
        name,
        city: text(record.municipio),
        state: uf && /^[A-Z]{2}$/.test(uf) ? uf : null,
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
