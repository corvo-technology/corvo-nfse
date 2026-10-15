import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ok } from '@/modules/invoice/domain/fiscal/result';
import { DefaultRtcMapper } from './default-rtc-mapper';

/**
 * Contract replay against the RUNNING local Calculadora RTC. Executes the
 * captured fixture requests (`docs/fiscal/rtc/fixtures/`) verbatim and checks
 * that the engine still answers the expected version/base/taxes. Skipped
 * unless RTC_CALCULATOR_URL points at a live instance, so regular unit runs
 * never touch the network.
 */
const url = process.env.RTC_CALCULATOR_URL;
const describeLive = url ? describe : describe.skip;

const fixturesDir = join(process.cwd(), '..', 'docs/fiscal/rtc/fixtures');
const load = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

interface LiveStep {
  method: string;
  path: string;
  request?: unknown;
}

const call = async (
  baseUrl: string,
  step: LiveStep,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}${step.path}`,
    step.method === 'POST'
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(step.request),
        }
      : { method: 'GET' },
  );
  return { status: response.status, body: await response.json() };
};

describeLive(`RTC contract against the live calculator (${url ?? ''})`, () => {
  jest.setTimeout(30_000);
  const mapper = new DefaultRtcMapper();
  const baseUrl = url ?? '';

  const liveVersion = async (): Promise<string> => {
    const { status, body } = await call(baseUrl, {
      method: 'GET',
      path: '/calculadora/dados-abertos/versao',
    });
    expect(status).toBe(200);
    const record = body as { versaoApp?: unknown; versaoDb?: unknown };
    return `${String(record.versaoApp)}/${String(record.versaoDb)}`;
  };

  it('ok-versao: the engine reports the expected version string', async () => {
    const f = load('ok-versao.json');
    const { status, body } = await call(baseUrl, f.steps[0]);
    expect(status).toBe(f.steps[0].status);
    const record = body as { versaoApp?: unknown; versaoDb?: unknown };
    expect(`${String(record.versaoApp)}/${String(record.versaoDb)}`).toBe(
      f.expected.version,
    );
  });

  it('ok-base-calculo-nfse-2026: replays the exact base request', async () => {
    const f = load('ok-base-calculo-nfse-2026.json');
    const { status, body } = await call(baseUrl, f.steps[0]);
    expect(status).toBe(f.steps[0].status);
    expect(mapper.fromBaseResponse(body)).toEqual(ok(f.expected.baseCalculo));
  });

  it.each(['ok-consultoria-2026', 'ok-reducao-60-2026'])(
    '%s: replays the exact calc request and maps the expected result',
    async (name) => {
      const f = load(`${name}.json`);
      const version = await liveVersion();
      const { status, body } = await call(baseUrl, f.steps[0]);
      expect(status).toBe(f.steps[0].status);
      const mapped = mapper.fromCalcResponse(body, f.input, version);
      expect(mapped).toMatchObject({
        ok: true,
        value: expect.objectContaining({ ...f.expected }),
      });
    },
  );
});
