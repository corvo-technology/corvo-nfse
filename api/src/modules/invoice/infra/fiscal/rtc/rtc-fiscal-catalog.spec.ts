import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type {
  ClassificationInput,
  ClassificationValidation,
} from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import { JsonFiscalCatalog } from '@/modules/invoice/domain/fiscal/classification/ctribnac-catalog';
import { CompositeFiscalCatalog } from '../composite-fiscal-catalog';
import { RtcFiscalCatalog } from './rtc-fiscal-catalog';
import { RtcHttpClient } from './rtc-http-client';

const fixturesDir = join(process.cwd(), '..', 'docs/fiscal/rtc/fixtures');

interface FixtureStep {
  readonly method: string;
  readonly path: string;
  readonly request?: Record<string, string>;
  readonly status: number;
  readonly response: unknown;
}

interface Fixture {
  readonly steps: ReadonlyArray<FixtureStep>;
  readonly expected: Record<string, unknown>;
}

const loadFixture = (name: string): Fixture =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as Fixture;

const okFixture = loadFixture('ok-indicador-valido.json');
const errorFixture = loadFixture('error-indicador-incompativel.json');
const okValidateStep = okFixture.steps.find(
  (step) => step.method === 'POST',
);
const errorValidateStep = errorFixture.steps.find((step) => step.method === 'POST');
if (okValidateStep === undefined || errorValidateStep === undefined) {
  throw new Error('validate fixtures must contain the captured POST steps');
}

const COMPETENCE = '2026-12-10';
const NBS_SINGLE = '115011000';
const NBS_MULTI = '114051200';

// Real responses captured from the calculator (app 1.6.0 / db V0059):
// 115011000 has a single CST x cClassTrib pair, 114051200 has two.
const COMBOS: Record<string, unknown> = {
  [NBS_SINGLE]: [
    {
      codigoSituacaoTributaria: '000',
      descricaoSituacaoTributaria: 'Tributação integral',
      codigoClassificacaoTributaria: '000001',
      descricaoClassificacaoTributaria:
        'Situações tributadas integralmente pelo IBS e CBS.',
    },
  ],
  [NBS_MULTI]: [
    {
      codigoSituacaoTributaria: '000',
      descricaoSituacaoTributaria: 'Tributação integral',
      codigoClassificacaoTributaria: '000001',
      descricaoClassificacaoTributaria:
        'Situações tributadas integralmente pelo IBS e CBS.',
    },
    {
      codigoSituacaoTributaria: '200',
      descricaoSituacaoTributaria: 'Alíquota reduzida',
      codigoClassificacaoTributaria: '200052',
      descricaoClassificacaoTributaria:
        'Prestação de serviços de profissões intelectuais',
    },
  ],
};

const NBS_LIST = [
  {
    codigo: NBS_SINGLE,
    descricao: 'Serviços de consultoria em tecnologia da informação (TI)',
  },
  {
    codigo: NBS_MULTI,
    descricao: 'Serviços de atendimento, assistência ou tratamento para animais domésticos',
  },
];

interface LoggedRequest {
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
}

interface Harness {
  readonly url: string;
  readonly requests: ReadonlyArray<LoggedRequest>;
  count(predicate: (request: LoggedRequest) => boolean): number;
  setVersion(version: { versaoApp: string; versaoDb: string }): void;
  close(): Promise<void>;
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const matchesCapture = (
  body: Record<string, unknown>,
  capture: Record<string, string>,
): boolean =>
  ['cIndOp', 'cClassTrib', 'nbs', 'dataOcorrenciaFatoGerador'].every(
    (field) => body[field] === capture[field],
  );

const startEngine = (): Promise<Harness> =>
  new Promise((resolve) => {
    const requests: LoggedRequest[] = [];
    let version = { versaoApp: '1.6.0', versaoDb: 'V0059' };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        raw += chunk;
      });
      req.on('end', () => {
        const method = req.method ?? 'GET';
        const requestUrl = req.url ?? '/';
        requests.push({ method, url: requestUrl, rawBody: raw });
        const parsed = new URL(requestUrl, 'http://calculator.local');
        const path = parsed.pathname;

        if (path.endsWith('/calculadora/dados-abertos/versao')) {
          sendJson(res, 200, { ...version, ambiente: 'offline' });
          return;
        }
        if (path.endsWith('/calculadora/dados-abertos/nbs/lista')) {
          const date = parsed.searchParams.get('data');
          if (date === null) {
            sendJson(res, 400, { title: 'Bad Request', status: 400 });
            return;
          }
          // db V0059 publishes no NBS before 2026-01-01.
          sendJson(res, 200, date < '2026-01-01' ? [] : NBS_LIST);
          return;
        }
        if (path.endsWith('/calculadora/nfse/situacoes-classificacoes-tributarias')) {
          const nbs = parsed.searchParams.get('nbs');
          const combos = nbs === null ? undefined : COMBOS[nbs];
          if (combos === undefined) {
            sendJson(res, 404, {
              type: 'http://localhost/errors/nbs-nao-encontrada',
              title: 'NBS não encontrada',
              status: 404,
            });
            return;
          }
          sendJson(res, 200, combos);
          return;
        }
        if (path.endsWith('/calculadora/nfse/indicador-operacao/validate')) {
          const body = JSON.parse(raw === '' ? '{}' : raw) as Record<
            string,
            unknown
          >;
          if (matchesCapture(body, okValidateStep.request ?? {})) {
            sendJson(res, okValidateStep.status, okValidateStep.response);
            return;
          }
          if (matchesCapture(body, errorValidateStep.request ?? {})) {
            sendJson(res, errorValidateStep.status, errorValidateStep.response);
            return;
          }
          sendJson(res, 400, {
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            detail: 'unexpected body for the fixture server',
          });
          return;
        }
        sendJson(res, 404, { type: 'about:blank', title: 'Not Found', status: 404 });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/api`,
        requests,
        count: (predicate) => requests.filter(predicate).length,
        setVersion: (next) => {
          version = next;
        },
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });

interface Clock {
  now(): number;
  advance(ms: number): void;
}

const clock = (): Clock => {
  let current = 1_770_000_000_000;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
};

const buildCatalog = (
  harness: Harness,
  time: Clock,
): RtcFiscalCatalog =>
  new RtcFiscalCatalog(
    new RtcHttpClient(harness.url, { timeoutMs: 5_000, maxConcurrency: 4 }),
    { now: time.now },
  );

const input = (
  overrides: Partial<ClassificationInput> = {},
): ClassificationInput => ({
  serviceCode: '010601',
  nbsCode: NBS_SINGLE,
  cst: '000',
  classCode: '000001',
  operationIndicator: null,
  ...overrides,
});

const expectInvalid = (
  validation: ClassificationValidation,
): Extract<ClassificationValidation, { status: 'invalid' }> => {
  if (validation.status !== 'invalid') {
    throw new Error(`expected invalid, got ${validation.status}`);
  }
  return validation;
};

const expectAmbiguous = (
  validation: ClassificationValidation,
): Extract<ClassificationValidation, { status: 'ambiguous' }> => {
  if (validation.status !== 'ambiguous') {
    throw new Error(`expected ambiguous, got ${validation.status}`);
  }
  return validation;
};

const expectUnavailable = (
  validation: ClassificationValidation,
): Extract<ClassificationValidation, { status: 'unavailable' }> => {
  if (validation.status !== 'unavailable') {
    throw new Error(`expected unavailable, got ${validation.status}`);
  }
  return validation;
};

const pathOf = (request: LoggedRequest): string =>
  new URL(request.url, 'http://calculator.local').pathname;

describe('RtcFiscalCatalog', () => {
  let harness: Harness;
  let time: Clock;

  beforeEach(async () => {
    harness = await startEngine();
    time = clock();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('rejects an NBS that the calculator does not publish on the competence date', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input({ nbsCode: '999999999' }),
      COMPETENCE,
    );
    const invalid = expectInvalid(validation);
    expect(invalid.issues).toEqual([
      {
        field: 'nbsCode',
        reason: expect.stringContaining('999999999'),
      },
    ]);
  });

  it('rejects a CST x cClassTrib pair outside the NBS list', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input({ cst: '200', classCode: '200045' }),
      COMPETENCE,
    );
    const invalid = expectInvalid(validation);
    expect(invalid.issues.map((issue) => issue.field).sort()).toEqual([
      'classCode',
      'cst',
    ]);
  });

  it('validates the correct pair and reports the calculator version', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input(),
      COMPETENCE,
    );
    expect(validation).toEqual({
      status: 'validated',
      versions: { rtc: '1.6.0/V0059' },
    });
  });

  it('accepts an unequivocal proposal when nothing is informed and the NBS has one combination', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input({ cst: null, classCode: null }),
      COMPETENCE,
    );
    expect(validation.status).toBe('validated');
  });

  it('answers ambiguous with the candidates when nothing is informed and the NBS has two combinations', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input({ nbsCode: NBS_MULTI, cst: null, classCode: null }),
      COMPETENCE,
    );
    expect(expectAmbiguous(validation).candidates).toEqual([
      { cst: '000', classCode: '000001' },
      { cst: '200', classCode: '200052' },
    ]);
  });

  it('rejects an incompatible cIndOp with the captured rejection', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input({ operationIndicator: '020101' }),
      COMPETENCE,
    );
    const invalid = expectInvalid(validation);
    expect(invalid.issues).toEqual([
      {
        field: 'operationIndicator',
        reason: expect.stringContaining('020101'),
      },
    ]);
  });

  it('accepts the compatible cIndOp captured from the calculator', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input({ operationIndicator: '100301' }),
      COMPETENCE,
    );
    expect(validation).toEqual({
      status: 'validated',
      versions: { rtc: '1.6.0/V0059' },
    });
  });

  it('sends the competence date on every catalog query and never today', async () => {
    const catalog = buildCatalog(harness, time);
    await catalog.validateClassification(
      input({ operationIndicator: '100301' }),
      COMPETENCE,
    );

    const today = new Date().toISOString().slice(0, 10);
    expect(
      harness.count(
        (request) =>
          pathOf(request).endsWith('/nbs/lista') &&
          request.url.includes(`data=${COMPETENCE}`),
      ),
    ).toBe(1);
    expect(
      harness.count(
        (request) =>
          pathOf(request).endsWith('/situacoes-classificacoes-tributarias') &&
          request.url.includes(`nbs=${NBS_SINGLE}`) &&
          request.url.includes(`data=${COMPETENCE}`),
      ),
    ).toBe(1);
    const validateRequests = harness.requests.filter((request) =>
      pathOf(request).endsWith('/indicador-operacao/validate'),
    );
    expect(validateRequests).toHaveLength(1);
    const body = JSON.parse(validateRequests[0].rawBody) as Record<
      string,
      unknown
    >;
    expect(body.dataOcorrenciaFatoGerador).toBe(COMPETENCE);
    expect(
      harness.requests.filter((request) => request.url.includes(today)),
    ).toEqual([]);
  });

  it('serves repeated validations from the cache without new calculator calls', async () => {
    const catalog = buildCatalog(harness, time);
    const classify = () =>
      catalog.validateClassification(
        input({ operationIndicator: '100301' }),
        COMPETENCE,
      );

    await classify();
    const second = await classify();

    expect(second.status).toBe('validated');
    expect(
      harness.count((request) => pathOf(request).endsWith('/versao')),
    ).toBe(1);
    expect(
      harness.count((request) => pathOf(request).endsWith('/nbs/lista')),
    ).toBe(1);
    expect(
      harness.count((request) =>
        pathOf(request).endsWith('/situacoes-classificacoes-tributarias'),
      ),
    ).toBe(1);
    expect(
      harness.count((request) =>
        pathOf(request).endsWith('/indicador-operacao/validate'),
      ),
    ).toBe(1);
  });

  it('clears the cache when versaoApp/versaoDb changes', async () => {
    const catalog = buildCatalog(harness, time);
    await catalog.validateClassification(
      input({ operationIndicator: '100301' }),
      COMPETENCE,
    );
    expect(
      harness.count((request) => pathOf(request).endsWith('/nbs/lista')),
    ).toBe(1);

    harness.setVersion({ versaoApp: '1.6.1', versaoDb: 'V0060' });
    time.advance(61_000);
    const revalidated = await catalog.validateClassification(
      input({ operationIndicator: '100301' }),
      COMPETENCE,
    );

    expect(revalidated).toEqual({
      status: 'validated',
      versions: { rtc: '1.6.1/V0060' },
    });
    expect(
      harness.count((request) => pathOf(request).endsWith('/versao')),
    ).toBe(2);
    expect(
      harness.count((request) => pathOf(request).endsWith('/nbs/lista')),
    ).toBe(2);
    expect(
      harness.count((request) =>
        pathOf(request).endsWith('/situacoes-classificacoes-tributarias'),
      ),
    ).toBe(2);
    expect(
      harness.count((request) =>
        pathOf(request).endsWith('/indicador-operacao/validate'),
      ),
    ).toBe(2);
  });

  it('expires the cached responses after the six hour TTL', async () => {
    const catalog = buildCatalog(harness, time);
    await catalog.validateClassification(input(), COMPETENCE);
    time.advance(6 * 60 * 60 * 1000 + 1);
    await catalog.validateClassification(input(), COMPETENCE);

    expect(
      harness.count((request) => pathOf(request).endsWith('/nbs/lista')),
    ).toBe(2);
  });

  it('answers unavailable and retryable while the calculator is down', async () => {
    const catalog = buildCatalog(harness, time);
    await harness.close();

    const validation = await catalog.validateClassification(
      input(),
      COMPETENCE,
    );
    const unavailable = expectUnavailable(validation);
    expect(unavailable.transient).toBe(true);
    expect(unavailable.reason).toContain('unreachable');
  });

  it('treats a date with no catalog data as a non-transient unavailable validation', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input(),
      '2025-12-01',
    );
    const unavailable = expectUnavailable(validation);
    expect(unavailable.transient).toBe(false);
    expect(unavailable.reason).toContain('2025-12-01');
  });

  it('skips the calculator when no NBS was informed', async () => {
    const catalog = buildCatalog(harness, time);
    const validation = await catalog.validateClassification(
      input({ nbsCode: null }),
      COMPETENCE,
    );
    expect(expectUnavailable(validation).transient).toBe(false);
    expect(harness.requests).toHaveLength(0);
  });
});

describe('CompositeFiscalCatalog', () => {
  const localCatalog = (): JsonFiscalCatalog =>
    new JsonFiscalCatalog({
      kind: 'ctribnac',
      version: 'ctribnac-2026.1',
      sourceUrl: 'https://example.invalid/ctribnac',
      publishedAt: '2026-01-01',
      checksum: 'sha256:stub',
      entries: [{ code: '060101', description: 'Barbearia e congêneres.' }],
    });

  it('keeps the local cTribNac lookup and reports the validation as unavailable when the RTC is not configured', async () => {
    const composite = new CompositeFiscalCatalog(localCatalog(), null);

    expect(composite.lookupServiceCode('060101')).toEqual({
      version: 'ctribnac-2026.1',
      found: true,
    });
    const validation = await composite.validateClassification(
      input(),
      COMPETENCE,
    );
    const unavailable = expectUnavailable(validation);
    expect(unavailable.transient).toBe(false);
    expect(unavailable.reason).toContain('not configured');
  });

  it('delegates the validation to the RTC catalog when configured', async () => {
    const validation: ClassificationValidation = {
      status: 'validated',
      versions: { rtc: '1.6.0/V0059' },
    };
    const rtcCatalog = {
      validateClassification: (): Promise<ClassificationValidation> =>
        Promise.resolve(validation),
    };
    const composite = new CompositeFiscalCatalog(localCatalog(), rtcCatalog);

    await expect(
      composite.validateClassification(input(), COMPETENCE),
    ).resolves.toEqual(validation);
  });
});
