import { Logger } from '@nestjs/common';

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface BrasilApiClientOptions {
  fetchFn?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

/** BrasilAPI's edge answers 403 to requests without a User-Agent (Node's fetch sends none). */
export const REGISTRY_USER_AGENT = 'corvo-nfse/1.0 (+https://corvo.tech)';
const HEADERS = {
  'User-Agent': REGISTRY_USER_AGENT,
  Accept: 'application/json',
};
/** Same field names as BrasilAPI (open source mirror of the Receita data); asked when the first one fails. */
const PROVIDERS: ((key: string) => string)[] = [
  (key) => `https://brasilapi.com.br/api/cnpj/v1/${key}`,
  (key) => `https://minhareceita.org/${key}`,
];

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3600_000;
/** A CNPJ the registry does not know may appear shortly after: remember the "not found" only briefly. */
const NOT_FOUND_TTL_MS = 5 * MINUTE_MS;
/** Oldest entries are dropped beyond this, so the cache cannot grow forever. */
const MAX_CACHED = 1000;

type Entry = { at: number; ttl: number; body: Record<string, unknown> | null };

/**
 * The one reader of the public CNPJ registry (BrasilAPI). Free and rate limited: it keeps the whole
 * answer for 24 h, so every view of it (Simples check, company profile, customer prefill) shares one call.
 * BrasilAPI is asked first, minhareceita.org when that fails (3 s each). A "not found" from both is kept for 5 min; any other failure (rate limit, 5xx, timeout, network) is never kept.
 * Never throws.
 */
export class BrasilApiCnpjClient {
  private readonly logger = new Logger(BrasilApiCnpjClient.name);
  private readonly cache = new Map<string, Entry>();
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(options: BrasilApiClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  /** Raw registry answer, or null when it is unavailable or does not know the CNPJ. */
  async fetch(cnpj: string): Promise<Record<string, unknown> | null> {
    // The new alphanumeric CNPJ keeps its letters: stripping them would query another company.
    const key = cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < cached.ttl) return cached.body;
    let allNotFound = true;
    for (const url of PROVIDERS) {
      const result = await this.ask(url(key), key);
      if (result.record) {
        this.remember(key, result.record, DAY_MS);
        return result.record;
      }
      if (!result.notFound) allNotFound = false;
    }
    if (allNotFound) this.remember(key, null, NOT_FOUND_TTL_MS);
    return null;
  }

  private async ask(
    url: string,
    key: string,
  ): Promise<{ record: Record<string, unknown> | null; notFound: boolean }> {
    const host = new URL(url).host;
    // Only the root (first 8 characters) of the CNPJ goes to the log.
    const who = `${host} ${key.slice(0, 8)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: HEADERS,
      });
      if (response.status === 404) return { record: null, notFound: true };
      if (!response.ok) {
        this.logger.warn(
          `CNPJ registry ${who} answered HTTP ${response.status}`,
        );
        return { record: null, notFound: false };
      }
      const body = await response.json();
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        this.logger.warn(`CNPJ registry ${who} sent an unexpected body`);
        return { record: null, notFound: false };
      }
      return { record: body as Record<string, unknown>, notFound: false };
    } catch (error) {
      this.logger.warn(`CNPJ registry ${who} failed: ${String(error)}`);
      return { record: null, notFound: false };
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(
    key: string,
    body: Record<string, unknown> | null,
    ttl: number,
  ) {
    if (this.cache.size >= MAX_CACHED)
      this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: this.now(), ttl, body });
  }
}

/** Shared by the adapters the app wires, so they all use one cache. */
export const sharedBrasilApiClient = new BrasilApiCnpjClient();
