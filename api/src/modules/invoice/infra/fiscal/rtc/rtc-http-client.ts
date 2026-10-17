/** Opções de uma chamada HTTP à Calculadora RTC (caminho relativo à base). */
export interface RtcRequestOptions {
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
}

/** Resposta bruta da Calculadora: o chamador decide o que fazer com o texto. */
export interface RtcHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** Motivos de falha puramente de transporte (antes de qualquer resposta HTTP). */
export type RtcTransportReason = 'timeout' | 'network';

/**
 * Falha de transporte local: a classe fica confinada a este módulo e nunca
 * atravessa o adapter — ele a converte em FiscalError. O tipo guard
 * {@link isRtcTransportError} expõe apenas o motivo, que é o único dado que o
 * adapter precisa para mapear timeout/rede.
 */
class RtcTransportError extends Error {
  constructor(readonly reason: RtcTransportReason) {
    super(`RTC transport error (${reason})`);
    this.name = 'RtcTransportError';
  }
}

export const isRtcTransportError = (
  error: unknown,
): error is { readonly reason: RtcTransportReason } =>
  error instanceof RtcTransportError;

/**
 * Cliente HTTP enxuto da Calculadora RTC: timeout por AbortController,
 * semáforo in-memory de concorrência máxima (a Calculadora official é um jar
 * único) e falhas de rede tipadas. `fetch` é injetável para os testes de
 * contrato; nunca envia nem registra autenticação própria.
 */
export class RtcHttpClient {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly baseUrl: string,
    private readonly options: { timeoutMs: number; maxConcurrency: number },
    private readonly http: typeof fetch = fetch,
  ) {}

  async request({
    path,
    method,
    body,
  }: RtcRequestOptions): Promise<RtcHttpResponse> {
    await this.acquire();
    try {
      return await this.send({ path, method, body });
    } finally {
      this.release();
    }
  }

  private async send({
    path,
    method,
    body,
  }: RtcRequestOptions): Promise<RtcHttpResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeoutMs);
    try {
      const response = await this.http(
        `${this.baseUrl.replace(/\/$/, '')}${path}`,
        {
          method,
          headers:
            body === undefined
              ? undefined
              : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const text = await response.text();
      return { status: response.status, headers: response.headers, text };
    } catch {
      throw new RtcTransportError(timedOut ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.options.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next !== undefined) next();
  }
}
