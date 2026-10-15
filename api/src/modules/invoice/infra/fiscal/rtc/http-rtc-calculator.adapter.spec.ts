import { Logger } from '@nestjs/common';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { metrics, type Attributes } from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { RtcConfig } from '@/infra/config/configuration';
import {
  fiscalError,
  type FiscalError,
} from '@/modules/invoice/domain/fiscal/fiscal-error';
import { ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import type {
  RtcCalculationInput,
} from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';
import { HttpRtcCalculatorAdapter } from './http-rtc-calculator.adapter';
import type { RtcMapper } from './rtc-mapper';

const VERSION_BODY = JSON.stringify({
  versaoApp: '1.6.0',
  descricaoVersaoApp: '1.6.0',
  versaoDb: 'V0059',
  descricaoVersaoDb: 'Habilitação de 820 para NFSe.',
  dataVersaoDb: '2026-09-30',
  ambiente: 'offline',
});

const TAX_RESULT: RtcTaxResult = {
  calculatorVersion: '1.6.0/V0059',
  cbs: { base: '870.00', rate: '0.90', effectiveRate: '0.90', reductionRate: '0', amount: '7.83' },
  ibsState: { base: '870.00', rate: '0.10', effectiveRate: '0.10', reductionRate: '0', amount: '0.87' },
  ibsCity: { base: '870.00', rate: '0.00', effectiveRate: '0.00', reductionRate: '0', amount: '0.00' },
  ibsTotal: { base: '870.00', amount: '0.87' },
  legalReferences: [],
  calculationMemory: [{ source: 'test' }],
  collectionWaived: false,
};

const rtcConfig = (url: string, overrides: Partial<RtcConfig> = {}): RtcConfig => ({
  url,
  timeoutMs: 1000,
  maxConcurrency: 4,
  circuitFailureThreshold: 2,
  circuitResetMs: 30_000,
  dpsLayout: 'rtc-v1.01',
  ...overrides,
});

const calculationInput = (): RtcCalculationInput => ({
  competenceDate: '2026-12-10',
  grossAmount: '1000.00',
  discountAmount: '0.00',
  issAmount: null,
  serviceCode: '010601',
  nbsCode: '115011000',
  cst: '000',
  classCode: '000001',
  operationIndicator: '100301',
  providerTaxId: '11222333000181',
  providerMunicipalityCode: '3550308',
  incidenceMunicipalityCode: '3550308',
  customer: null,
  regime: 'LUCRO_PRESUMIDO',
});

class FakeRtcMapper implements RtcMapper {
  problem: FiscalError | null = null;
  baseBody: unknown = {};

  toBaseRequest(): { path: '/calculadora/nfse/base-calculo'; body: unknown } {
    return { path: '/calculadora/nfse/base-calculo', body: this.baseBody };
  }

  fromBaseResponse(): Result<string, FiscalError> {
    return ok('870.00');
  }

  toCalcRequest(): { path: '/calculadora/regime-geral'; body: unknown } {
    return { path: '/calculadora/regime-geral', body: {} };
  }

  fromCalcResponse(): Result<RtcTaxResult, FiscalError> {
    return ok(TAX_RESULT);
  }

  fromProblem(): FiscalError | null {
    return this.problem;
  }
}

interface Harness {
  readonly url: string;
  readonly requests: string[];
  peak(): number;
  close(): Promise<void>;
}

type Responder = (
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string,
) => void;

const startServer = (respond: Responder): Promise<Harness> =>
  new Promise((resolve) => {
    const requests: string[] = [];
    let inflight = 0;
    let peak = 0;
    const server = createServer((req, res) => {
      requests.push(req.url ?? '/');
      inflight += 1;
      peak = Math.max(peak, inflight);
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          inflight -= 1;
        }
      };
      res.on('finish', settle);
      res.on('close', settle);
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        raw += chunk;
      });
      req.on('end', () => respond(req, res, raw));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/api`,
        requests,
        peak: () => peak,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

/** Answers version + base + calc with engine-shaped 200s. */
const healthyEngine: Responder = (req, res) => {
  const url = req.url ?? '';
  if (url.endsWith('/calculadora/dados-abertos/versao')) {
    sendJson(res, 200, VERSION_BODY);
    return;
  }
  if (url.endsWith('/calculadora/nfse/base-calculo')) {
    sendJson(res, 200, { baseCalculo: 870 });
    return;
  }
  if (url.endsWith('/calculadora/regime-geral')) {
    sendJson(res, 200, { objetos: [] });
    return;
  }
  sendJson(res, 404, { type: 'http://localhost/errors/not-found' });
};

const failureOf = <T>(result: Result<T, FiscalError>): FiscalError => {
  if (result.ok) throw new Error('expected the adapter to fail');
  return result.error;
};

const pathOf = (url: string): string => url.replace(/^\/api/, '');

const adapterFor = (
  harness: Harness,
  opts: { mapper?: FakeRtcMapper; config?: Partial<RtcConfig> } = {},
): HttpRtcCalculatorAdapter =>
  new HttpRtcCalculatorAdapter(
    rtcConfig(harness.url, opts.config),
    opts.mapper ?? new FakeRtcMapper(),
  );

describe('HttpRtcCalculatorAdapter', () => {
  let exporter: InMemoryMetricExporter;
  let provider: MeterProvider;

  beforeAll(() => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    expect(metrics.setGlobalMeterProvider(provider)).toBe(true);
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  const versionInfoPoint = async (): Promise<
    { attributes: Attributes; value: number } | undefined
  > => {
    await provider.forceFlush();
    const resources = await exporter.getMetrics();
    for (const resource of resources.flatMap((entry) => entry.scopeMetrics)) {
      const metric = resource.metrics.find(
        (candidate) => candidate.descriptor.name === 'greenflow.rtc.version_info',
      );
      if (metric === undefined) continue;
      if (metric.dataPointType !== DataPointType.GAUGE) {
        throw new Error('greenflow.rtc.version_info is not a gauge');
      }
      const point = metric.dataPoints[0];
      return point === undefined
        ? undefined
        : { attributes: point.attributes, value: point.value };
    }
    return undefined;
  };

  it('runs version → base → calc in order and returns the mapped result', async () => {
    const harness = await startServer(healthyEngine);
    const adapter = adapterFor(harness);

    const result = await adapter.calculate(calculationInput());

    expect(result).toEqual(ok(TAX_RESULT));
    expect(harness.requests.map(pathOf)).toEqual([
      '/calculadora/dados-abertos/versao',
      '/calculadora/nfse/base-calculo',
      '/calculadora/regime-geral',
    ]);

    await harness.close();
  });

  it('stops after the base call fails (calc is not called)', async () => {
    const harness = await startServer((req, res) => {
      if ((req.url ?? '').endsWith('/versao')) {
        sendJson(res, 200, VERSION_BODY);
        return;
      }
      sendJson(res, 500, { message: 'engine exploding' });
    });
    const adapter = adapterFor(harness);

    const error = failureOf(await adapter.calculate(calculationInput()));

    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      category: 'INTEGRATION',
      retryable: true,
      details: { reason: 'upstream_5xx' },
    });
    expect(harness.requests.some((url) => pathOf(url).endsWith('regime-geral'))).toBe(false);

    await harness.close();
  });

  it('maps a timeout to a retryable TAX_CALCULATION_UNAVAILABLE', async () => {
    const harness = await startServer((req, res) => {
      if ((req.url ?? '').endsWith('/versao')) {
        sendJson(res, 200, VERSION_BODY);
        return;
      }
      // The base call never answers: only the abort can end it.
    });
    const adapter = adapterFor(harness, { config: { timeoutMs: 50 } });

    const error = failureOf(await adapter.calculate(calculationInput()));

    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      category: 'INTEGRATION',
      retryable: true,
      details: { reason: 'timeout' },
    });

    await harness.close();
  });

  it('maps connection refused (service still starting) to a retryable error', async () => {
    const harness = await startServer(healthyEngine);
    const url = harness.url;
    await harness.close();
    const adapter = new HttpRtcCalculatorAdapter(
      rtcConfig(url),
      new FakeRtcMapper(),
    );

    const error = failureOf(await adapter.calculate(calculationInput()));

    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      retryable: true,
      details: { reason: 'network' },
    });
  });

  it('maps 503 to a retryable error', async () => {
    const harness = await startServer((req, res) => {
      if ((req.url ?? '').endsWith('/versao')) {
        sendJson(res, 200, VERSION_BODY);
        return;
      }
      sendJson(res, 503, { message: 'starting up' });
    });
    const adapter = adapterFor(harness);

    const error = failureOf(await adapter.calculate(calculationInput()));

    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      retryable: true,
      details: { reason: 'upstream_5xx' },
    });

    await harness.close();
  });

  it('maps 429 with Retry-After to retryAfterMs', async () => {
    const harness = await startServer((req, res) => {
      if ((req.url ?? '').endsWith('/versao')) {
        sendJson(res, 200, VERSION_BODY);
        return;
      }
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '2',
      });
      res.end(JSON.stringify({ message: 'slow down' }));
    });
    const adapter = adapterFor(harness);

    const error = failureOf(await adapter.calculate(calculationInput()));

    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      retryable: true,
      details: { reason: 'rate_limited', retryAfterMs: 2000 },
    });

    await harness.close();
  });

  it('opens the circuit after the threshold and then does not call the network', async () => {
    const harness = await startServer((req, res) => {
      if ((req.url ?? '').endsWith('/versao')) {
        sendJson(res, 200, VERSION_BODY);
        return;
      }
      sendJson(res, 503, { message: 'starting up' });
    });
    const adapter = adapterFor(harness);

    failureOf(await adapter.calculate(calculationInput()));
    failureOf(await adapter.calculate(calculationInput()));
    const requestsBefore = harness.requests.length;

    const error = failureOf(await adapter.calculate(calculationInput()));

    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      retryable: true,
      details: { reason: 'circuit_open' },
    });
    expect(harness.requests).toHaveLength(requestsBefore);

    await harness.close();
  });

  it('maps an unknown 4xx to TAX_CALCULATION_UNSUPPORTED', async () => {
    const harness = await startServer((req, res) => {
      if ((req.url ?? '').endsWith('/versao')) {
        sendJson(res, 200, VERSION_BODY);
        return;
      }
      sendJson(res, 400, {
        type: 'http://localhost/errors/outro-erro',
        status: 400,
      });
    });
    const adapter = adapterFor(harness, { mapper: new FakeRtcMapper() });

    const error = failureOf(await adapter.calculate(calculationInput()));

    expect(error).toMatchObject({
      code: 'TAX_CALCULATION_UNSUPPORTED',
      category: 'UNSUPPORTED',
      retryable: false,
      details: { status: 400 },
    });

    await harness.close();
  });

  it('uses mapper.fromProblem for a known 4xx', async () => {
    const mapper = new FakeRtcMapper();
    mapper.problem = fiscalError({
      code: 'TAX_RATE_NOT_FOUND',
      message: 'As alíquotas nominais devem ser informadas a partir de 2027',
      category: 'CONFIGURATION',
      step: 'RtcTaxCalculator',
      details: { status: 422 },
      retryable: false,
    });
    const harness = await startServer((req, res) => {
      if ((req.url ?? '').endsWith('/versao')) {
        sendJson(res, 200, VERSION_BODY);
        return;
      }
      sendJson(res, 422, {
        type: 'http://localhost/errors/aliquotas-nominais-nao-informadas',
        status: 422,
      });
    });
    const adapter = adapterFor(harness, { mapper });

    const result = await adapter.calculate(calculationInput());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the adapter to fail');
    expect(result.error).toBe(mapper.problem);

    await harness.close();
  });

  it('rejects a non-JSON 200 body as rtc_invalid_response (not retryable)', async () => {
    const harness = await startServer((req, res) => {
      if ((req.url ?? '').endsWith('/versao')) {
        sendJson(res, 200, VERSION_BODY);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('<html>maintenance</html>');
    });
    const adapter = adapterFor(harness);

    const error = failureOf(await adapter.calculate(calculationInput()));

    expect(error).toMatchObject({
      code: 'FISCAL_VALIDATION_FAILED',
      retryable: false,
      details: { reason: 'rtc_invalid_response' },
    });

    await harness.close();
  });

  it('never leaks raw HTTP/SDK errors (every failure is a FiscalError)', async () => {
    const scenarios: Array<{ name: string; adapter: HttpRtcCalculatorAdapter }> = [];

    const refused = await startServer(healthyEngine);
    const refusedUrl = refused.url;
    await refused.close();
    scenarios.push({
      name: 'connection refused',
      adapter: new HttpRtcCalculatorAdapter(
        rtcConfig(refusedUrl),
        new FakeRtcMapper(),
      ),
    });

    const hanging = await startServer(() => undefined);
    scenarios.push({
      name: 'timeout',
      adapter: adapterFor(hanging, { config: { timeoutMs: 50 } }),
    });

    const serverError = await startServer((_req, res) =>
      sendJson(res, 500, { message: 'boom' }),
    );
    scenarios.push({ name: '5xx', adapter: adapterFor(serverError) });

    const invalidJson = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json');
    });
    scenarios.push({ name: 'invalid json', adapter: adapterFor(invalidJson) });

    const knownProblem = await startServer((_req, res) =>
      sendJson(res, 404, {
        type: 'http://localhost/errors/classificacao-tributaria-nao-encontrada',
        status: 404,
      }),
    );
    const knownMapper = new FakeRtcMapper();
    knownMapper.problem = fiscalError({
      code: 'FISCAL_CLASSIFICATION_INVALID',
      message: 'Classificação tributária não encontrada',
      category: 'CLASSIFICATION',
      step: 'RtcTaxCalculator',
      details: { status: 404 },
      retryable: false,
    });
    scenarios.push({
      name: 'known problem',
      adapter: adapterFor(knownProblem, { mapper: knownMapper }),
    });

    for (const scenario of scenarios) {
      const error = failureOf(
        await scenario.adapter.calculate(calculationInput()),
      );
      expect(typeof error.code).toBe('string');
      expect(typeof error.message).toBe('string');
      expect(typeof error.category).toBe('string');
      expect(typeof error.retryable).toBe('boolean');
      expect(error.details).toEqual(expect.any(Object));
      expect(error).not.toBeInstanceOf(Error);
    }

    await hanging.close();
    await serverError.close();
    await invalidJson.close();
    await knownProblem.close();
  });

  it('limits concurrency to RTC_CALCULATOR_MAX_CONCURRENCY', async () => {
    const harness = await startServer((req, res) => {
      setTimeout(() => healthyEngine(req, res, ''), 5);
    });
    const adapter = adapterFor(harness, { config: { maxConcurrency: 3 } });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => adapter.calculate(calculationInput())),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(harness.peak()).toBeLessThanOrEqual(3);
    // No request is ever coalesced: 20 × (version + base + calc).
    expect(harness.requests).toHaveLength(60);

    await harness.close();
  });

  it('version() reads and caches versaoApp/versaoDb for 60 s', async () => {
    const harness = await startServer(healthyEngine);
    const adapter = adapterFor(harness);

    expect(await adapter.version()).toEqual(ok('1.6.0/V0059'));
    expect(await adapter.version()).toEqual(ok('1.6.0/V0059'));

    expect(
      harness.requests.filter((url) => pathOf(url).endsWith('/versao')),
    ).toHaveLength(1);

    await harness.close();
  });

  it('records version_info and warns at most once per hour when the version differs from expected', async () => {
    const harness = await startServer(healthyEngine);
    const clock = jest.spyOn(Date, 'now');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const versionWarnings = (): string[] =>
      warnSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('differs from expected'));
    const start = Date.UTC(2026, 9, 14, 12, 0, 0);

    try {
      clock.mockReturnValue(start);
      const adapter = adapterFor(harness, {
        config: { expectedVersion: '1.5.0/V0058' },
      });

      expect(await adapter.version()).toEqual(ok('1.6.0/V0059'));
      expect(versionWarnings()).toHaveLength(1);

      // Still inside the hourly window: the version refreshes, the warn does not.
      clock.mockReturnValue(start + 30 * 60_000);
      expect(await adapter.version()).toEqual(ok('1.6.0/V0059'));
      expect(versionWarnings()).toHaveLength(1);

      // Window elapsed: warning may fire again.
      clock.mockReturnValue(start + 61 * 60_000);
      expect(await adapter.version()).toEqual(ok('1.6.0/V0059'));
      expect(versionWarnings()).toHaveLength(2);

      const point = await versionInfoPoint();
      expect(point?.value).toBe(1);
      expect(point?.attributes).toMatchObject({ version: '1.6.0/V0059' });
    } finally {
      clock.mockRestore();
      warnSpy.mockRestore();
      await harness.close();
    }
  });

  it('does not warn when the published version matches RTC_EXPECTED_VERSION', async () => {
    const harness = await startServer(healthyEngine);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    try {
      const adapter = adapterFor(harness, {
        config: { expectedVersion: '1.6.0/V0059' },
      });

      expect(await adapter.version()).toEqual(ok('1.6.0/V0059'));

      const versionWarnings = warnSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('differs from expected'));
      expect(versionWarnings).toHaveLength(0);

      const point = await versionInfoPoint();
      expect(point?.value).toBe(1);
      expect(point?.attributes).toMatchObject({ version: '1.6.0/V0059' });
    } finally {
      warnSpy.mockRestore();
      await harness.close();
    }
  });

  it('health() is available:true only when the version endpoint answers 200', async () => {
    const healthy = await startServer(healthyEngine);
    const healthyResult = await adapterFor(healthy).health();
    expect(healthyResult).toEqual(ok({ available: true }));
    await healthy.close();

    const broken = await startServer((_req, res) =>
      sendJson(res, 500, { message: 'starting' }),
    );
    const brokenResult = await adapterFor(broken).health();
    expect(brokenResult.ok).toBe(false);
    if (brokenResult.ok) throw new Error('expected health to fail');
    expect(brokenResult.error.code).toBe('TAX_CALCULATION_UNAVAILABLE');
    await broken.close();
  });

  it('does not log the request body', async () => {
    const canary = 'LEAK_CANARY_9f3c2';
    const mapper = new FakeRtcMapper();
    mapper.baseBody = { secret: canary };
    const harness = await startServer((_req, res) =>
      sendJson(res, 500, { message: 'boom' }),
    );
    const adapter = adapterFor(harness, { mapper });
    const methods = ['log', 'error', 'warn', 'debug', 'verbose'] as const;
    const spies = methods.map((method) =>
      jest.spyOn(Logger.prototype, method),
    );

    try {
      failureOf(await adapter.calculate(calculationInput()));
      const logged = spies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => JSON.stringify(args))
        .join('\n');
      expect(logged).not.toContain(canary);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      await harness.close();
    }
  });
});
