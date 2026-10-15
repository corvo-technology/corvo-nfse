import { Logger } from '@nestjs/common';
import type { RtcConfig } from '@/infra/config/configuration';
import {
  fiscalError,
  type FiscalError,
} from '@/modules/invoice/domain/fiscal/fiscal-error';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import {
  RtcCalculatorPort,
  type RtcCalculationInput,
} from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';
import { CircuitBreaker } from './circuit-breaker';
import {
  isRtcTransportError,
  RtcHttpClient,
  type RtcHttpResponse,
} from './rtc-http-client';
import {
  recordRtcCalculationDuration,
  recordRtcCalculationFailure,
  recordRtcCalculatorLatency,
} from './rtc.metrics';
import type { RtcMapper } from './rtc-mapper';

const STEP_NAME = 'RtcTaxCalculator';
const VERSION_CACHE_MS = 60_000;
const VERSION_PATH = '/calculadora/dados-abertos/versao';

type FailureReason =
  | 'timeout'
  | 'network'
  | 'upstream_5xx'
  | 'rate_limited'
  | 'circuit_open';

const unavailable = (
  reason: FailureReason,
  details: Record<string, unknown> = {},
): FiscalError =>
  fiscalError({
    code: 'TAX_CALCULATION_UNAVAILABLE',
    message: `The RTC calculator failed to answer (${reason})`,
    category: 'INTEGRATION',
    step: STEP_NAME,
    details: { reason, ...details },
    retryable: true,
  });

const invalidResponse = (detail: string): FiscalError =>
  fiscalError({
    code: 'FISCAL_VALIDATION_FAILED',
    message: `The RTC calculator returned an invalid response (${detail})`,
    category: 'CALCULATION',
    step: STEP_NAME,
    details: { reason: 'rtc_invalid_response', detail },
    retryable: false,
  });

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const retryAfterMsFrom = (headers: Headers): number | null => {
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
};

const failureReasonOf = (error: FiscalError): string => {
  const reason = error.details.reason;
  return typeof reason === 'string' ? reason : error.code;
};

/**
 * Adapter HTTP do `RtcCalculatorPort` contra a Calculadora RTC oficial em
 * rede privada (`docs/fiscal/rtc/`): lê a versão do serviço (cache de 60 s),
 * pede a base da NFS-e (`nfse/base-calculo`) e então o cálculo
 * (`regime-geral`). Falhas de transporte/rede viram TAX_CALCULATION_UNAVAILABLE
 * reprocessável (a Calculadora é serviço interno: timeout ainda subindo é
 * normal); 4xx passa pelo mapper; circuito aberto rejeita sem tocar a rede.
 * O corpo da requisição nunca é logado.
 */
export class HttpRtcCalculatorAdapter extends RtcCalculatorPort {
  private readonly logger = new Logger(HttpRtcCalculatorAdapter.name);
  private readonly http: RtcHttpClient;
  private readonly breaker: CircuitBreaker;
  private cachedVersion: { value: string; at: number } | null = null;

  constructor(
    config: RtcConfig,
    private readonly mapper: RtcMapper,
    http: typeof fetch = fetch,
  ) {
    super();
    this.http = new RtcHttpClient(
      config.url ?? '',
      {
        timeoutMs: config.timeoutMs,
        maxConcurrency: config.maxConcurrency,
      },
      http,
    );
    this.breaker = new CircuitBreaker({
      failureThreshold: config.circuitFailureThreshold,
      resetMs: config.circuitResetMs,
    });
  }

  /** Disponível apenas quando o endpoint de versão responde 200 agora. */
  async health(): Promise<Result<{ available: true }, FiscalError>> {
    const gate = this.gate();
    if (gate !== null) return err(gate);
    const outcome = await this.fetchVersion();
    if (!outcome.ok) return outcome;
    return ok({ available: true });
  }

  /** `"{versaoApp}/{versaoDb}"` (ex.: `1.6.0/V0059`), em cache por 60 s. */
  async version(): Promise<Result<string, FiscalError>> {
    const gate = this.gate();
    if (gate !== null) return err(gate);
    return this.cachedVersionOf();
  }

  async calculate(
    input: RtcCalculationInput,
  ): Promise<Result<RtcTaxResult, FiscalError>> {
    const startedAt = Date.now();
    const outcome = await this.run(input);
    recordRtcCalculationDuration(
      (Date.now() - startedAt) / 1000,
      outcome.ok ? 'ok' : outcome.error.code,
    );
    if (!outcome.ok) recordRtcCalculationFailure(failureReasonOf(outcome.error));
    return outcome;
  }

  private async run(
    input: RtcCalculationInput,
  ): Promise<Result<RtcTaxResult, FiscalError>> {
    const gate = this.gate();
    if (gate !== null) return err(gate);

    const version = await this.cachedVersionOf();
    if (!version.ok) return version;

    const baseRequest = this.mapper.toBaseRequest(input);
    const baseResponse = await this.exchange(
      'POST',
      baseRequest.path,
      baseRequest.body,
    );
    if (!baseResponse.ok) return baseResponse;
    const base = this.mapper.fromBaseResponse(baseResponse.value);
    if (!base.ok) return base;

    const calcRequest = this.mapper.toCalcRequest(input, base.value);
    const calcResponse = await this.exchange(
      'POST',
      calcRequest.path,
      calcRequest.body,
    );
    if (!calcResponse.ok) return calcResponse;
    return this.mapper.fromCalcResponse(
      calcResponse.value,
      input,
      version.value,
    );
  }

  /** Rejeita sem tocar a rede enquanto o disjuntor estiver aberto. */
  private gate(): FiscalError | null {
    if (this.breaker.canPass()) return null;
    this.logger.warn('RTC calculator circuit is open; rejecting the call');
    return unavailable('circuit_open');
  }

  private async cachedVersionOf(): Promise<Result<string, FiscalError>> {
    const cached = this.cachedVersion;
    if (cached !== null && Date.now() - cached.at < VERSION_CACHE_MS) {
      return ok(cached.value);
    }
    const outcome = await this.fetchVersion();
    if (!outcome.ok) return outcome;
    this.cachedVersion = { value: outcome.value, at: Date.now() };
    return outcome;
  }

  private async fetchVersion(): Promise<Result<string, FiscalError>> {
    const response = await this.exchange('GET', VERSION_PATH);
    if (!response.ok) return response;
    const payload = response.value;
    if (typeof payload !== 'object' || payload === null) {
      return err(invalidResponse('version payload is not an object'));
    }
    const { versaoApp, versaoDb } = payload as {
      versaoApp?: unknown;
      versaoDb?: unknown;
    };
    if (
      typeof versaoApp !== 'string' ||
      typeof versaoDb !== 'string' ||
      versaoApp === '' ||
      versaoDb === ''
    ) {
      return err(invalidResponse('version payload lacks versaoApp/versaoDb'));
    }
    return ok(`${versaoApp}/${versaoDb}`);
  }

  /**
   * Uma chamada HTTP + classificação de resultado. Conta latência do engine,
   * alimenta o disjuntor (falha em timeout/rede/5xx/429; sucesso quando o
   * engine responde, inclusive 4xx — o problema aí é fiscal, não de
   * disponibilidade) e converte tudo em `Result` tipado.
   */
  private async exchange(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Result<unknown, FiscalError>> {
    const startedAt = Date.now();
    let response: RtcHttpResponse;
    try {
      response = await this.http.request({ path, method, body });
    } catch (error) {
      recordRtcCalculatorLatency((Date.now() - startedAt) / 1000, path);
      if (isRtcTransportError(error)) {
        this.breaker.onFailure();
        this.logger.warn(
          `RTC calculator transport failure (${error.reason}) on ${method} ${path}`,
        );
        return err(unavailable(error.reason));
      }
      throw error;
    }
    recordRtcCalculatorLatency((Date.now() - startedAt) / 1000, path);

    if (response.status >= 200 && response.status < 300) {
      this.breaker.onSuccess();
      const payload = parseJson(response.text);
      if (payload === undefined) {
        return err(invalidResponse(`non-JSON 2xx body on ${method} ${path}`));
      }
      return ok(payload);
    }

    if (response.status === 429) {
      this.breaker.onFailure();
      this.logger.warn(
        `RTC calculator rate limited the call (429) on ${method} ${path}`,
      );
      const retryAfterMs = retryAfterMsFrom(response.headers);
      return err(
        unavailable(
          'rate_limited',
          retryAfterMs === null ? {} : { retryAfterMs },
        ),
      );
    }

    if (response.status >= 400 && response.status < 500) {
      this.breaker.onSuccess();
      const mapped = this.mapper.fromProblem(
        response.status,
        parseJson(response.text),
      );
      if (mapped !== null) return err(mapped);
      return err(
        fiscalError({
          code: 'TAX_CALCULATION_UNSUPPORTED',
          message: `The RTC calculator rejected the request with HTTP ${response.status}`,
          category: 'UNSUPPORTED',
          step: STEP_NAME,
          details: { status: response.status },
          retryable: false,
        }),
      );
    }

    this.breaker.onFailure();
    this.logger.warn(
      `RTC calculator answered HTTP ${response.status} on ${method} ${path}`,
    );
    return err(unavailable('upstream_5xx'));
  }
}
