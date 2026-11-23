/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DefaultRtcMapper } from './default-rtc-mapper';

const dir = join(process.cwd(), '..', 'docs/fiscal/rtc/fixtures');
const load = (name: string) =>
  JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
const mapper = new DefaultRtcMapper();

describe('DefaultRtcMapper (real captured fixtures)', () => {
  it('builds the base request exactly as the engine accepted it', () => {
    const f = load('ok-base-calculo-nfse-2026');
    const input = {
      ...load('ok-consultoria-2026').input,
      competenceDate: '2026-12-10',
      grossAmount: '1000.00',
      discountAmount: '100.00',
      issAmount: '30.00',
    };
    expect(mapper.toBaseRequest(input).body).toEqual(f.steps[0].request);
    expect(mapper.fromBaseResponse(f.steps[0].response)).toEqual({
      ok: true,
      value: '870.00',
    });
  });

  it('builds the calc request from the base and maps the response to the typed result', () => {
    const f = load('ok-consultoria-2026');
    expect(mapper.toCalcRequest(f.input, '1000.00').body).toEqual({
      ...f.steps[0].request,
      id: expect.any(String),
    });
    // The version is echoed into the result: use the one the fixture was captured with.
    expect(
      mapper.fromCalcResponse(
        f.steps[0].response,
        f.input,
        f.expected.calculatorVersion as string,
      ),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({
        ...f.expected,
        legalReferences: [],
        calculationMemory: expect.any(Array),
      }),
    });
  });

  it('maps the 60% reduction (effective rate and reduction rate)', () => {
    const f = load('ok-reducao-60-2026');
    const r = mapper.fromCalcResponse(
      f.steps[0].response,
      f.input,
      '1.7.2/V0073',
    );
    expect(r.ok && r.value.cbs).toEqual(f.expected.cbs);
    expect(r.ok && r.value.ibsState).toEqual(f.expected.ibsState);
  });

  it('never sends nominal rates', () => {
    const f = load('ok-consultoria-2026');
    expect(
      JSON.stringify(mapper.toCalcRequest(f.input, '1000.00').body),
    ).not.toContain('aliquotasNominais');
  });

  it.each([
    'error-2027-aliquotas-nominais',
    'error-classificacao-nao-encontrada',
  ])('%s maps to the expected typed error', (name) => {
    const f = load(name);
    const step = f.steps[0];
    expect(mapper.fromProblem(step.status, step.response)).toMatchObject({
      ...f.expectedError,
    });
  });

  it('returns null for an unknown problem type', () => {
    expect(
      mapper.fromProblem(400, {
        type: 'http://localhost/errors/outro',
        status: 400,
      }),
    ).toBeNull();
  });

  it('rejects a simulated result', () => {
    const f = load('ok-consultoria-2026');
    const body = JSON.parse(JSON.stringify(f.steps[0].response));
    body.objetos[0].calculoSimulado = true;
    expect(mapper.fromCalcResponse(body, f.input, 'v')).toMatchObject({
      ok: false,
      error: { code: 'TAX_RATE_NOT_FOUND', retryable: false },
    });
  });

  it('rejects a response missing a required amount, with the missing path', () => {
    const f = load('ok-consultoria-2026');
    const body = JSON.parse(JSON.stringify(f.steps[0].response));
    delete body.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS;
    expect(mapper.fromCalcResponse(body, f.input, 'v')).toMatchObject({
      ok: false,
      error: {
        code: 'FISCAL_VALIDATION_FAILED',
        details: { reason: 'rtc_invalid_response' },
      },
    });
  });

  it('rejects wrong types and negative amounts', () => {
    const f = load('ok-consultoria-2026');
    const wrong = JSON.parse(JSON.stringify(f.steps[0].response));
    wrong.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS = 'abc';
    expect(mapper.fromCalcResponse(wrong, f.input, 'v').ok).toBe(false);
    const neg = JSON.parse(JSON.stringify(f.steps[0].response));
    neg.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS = '-1.00';
    expect(mapper.fromCalcResponse(neg, f.input, 'v').ok).toBe(false);
  });

  it('rejects a non-zero deferral instead of ignoring it', () => {
    const f = load('ok-consultoria-2026');
    const body = JSON.parse(JSON.stringify(f.steps[0].response));
    body.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.gDif = {
      pDif: '10.00',
      vDif: '0.90',
    };
    expect(mapper.fromCalcResponse(body, f.input, 'v')).toMatchObject({
      ok: false,
      error: { code: 'TAX_CALCULATION_UNSUPPORTED' },
    });
  });

  it('keeps monetary values as decimal strings without float drift', () => {
    const f = load('ok-consultoria-2026');
    const body = JSON.parse(JSON.stringify(f.steps[0].response));
    body.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS = '0.30';
    const r = mapper.fromCalcResponse(body, f.input, 'v');
    expect(r.ok && r.value.cbs?.amount).toBe('0.30');
  });
});
