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

  describe('memoriaCalculo (1.7.x)', () => {
    const f = load('ok-consultoria-2026');
    const clone = () => JSON.parse(JSON.stringify(f.steps[0].response));
    const memoryOf = (body: unknown) => {
      const r = mapper.fromCalcResponse(body, f.input, 'v');
      return r.ok ? r.value.calculationMemory : null;
    };

    it('reads the memory from tribCalc.IBSCBS.memoriaCalculo (real 1.7.2 capture)', () => {
      const ibscbs = f.steps[0].response.objetos[0].tribCalc.IBSCBS;
      expect(memoryOf(f.steps[0].response)).toEqual([
        ibscbs.memoriaCalculo.cbs,
        ibscbs.memoriaCalculo.ibsUF,
        ibscbs.memoriaCalculo.ibsMun,
      ]);
      expect(memoryOf(f.steps[0].response)?.every(Boolean)).toBe(true);
    });

    it('still accepts the memory inside gIBSCBS or inside each group', () => {
      const inGroup = clone();
      const ibscbs = inGroup.objetos[0].tribCalc.IBSCBS;
      const memory = ibscbs.memoriaCalculo;
      delete ibscbs.memoriaCalculo;
      ibscbs.gIBSCBS.memoriaCalculo = memory;
      expect(memoryOf(inGroup)).toEqual([
        memory.cbs,
        memory.ibsUF,
        memory.ibsMun,
      ]);

      const legacy = clone();
      const l = legacy.objetos[0].tribCalc.IBSCBS;
      delete l.memoriaCalculo;
      l.gIBSCBS.gCBS.memoriaCalculo = 'c';
      l.gIBSCBS.gIBSUF.memoriaCalculo = 'u';
      l.gIBSCBS.gIBSMun.memoriaCalculo = 'm';
      expect(memoryOf(legacy)).toEqual(['c', 'u', 'm']);
    });
  });

  describe('rounding of 1.7.2 (totals come from the engine, never recomputed)', () => {
    // Exemplo do CHANGELOG 1.7.2: base 12,00, IBS 0,05% UF + 0,05% Município.
    // Cada valor exibido é arredondado uma vez: vIBSUF 0.01, vIBSMun 0.01, vIBS 0.02.
    // Recalcular pela alíquota somada (12,00 x 0,10%) daria 0.01, um centavo a menos.
    it('keeps vIBS = vIBSUF + vIBSMun exactly as the engine published it', () => {
      const f = load('ok-consultoria-2026');
      const body = JSON.parse(JSON.stringify(f.steps[0].response));
      const g = body.objetos[0].tribCalc.IBSCBS.gIBSCBS;
      g.vBC = '12.00';
      g.gIBSUF = { pIBSUF: '0.05', vIBSUF: '0.01' };
      g.gIBSMun = { pIBSMun: '0.05', vIBSMun: '0.01' };
      g.vIBS = '0.02';
      const r = mapper.fromCalcResponse(body, f.input, 'v');
      if (!r.ok) throw new Error('expected ok');
      expect(r.value.ibsTotal).toEqual({ base: '12.00', amount: '0.02' });
      expect(r.value.ibsState?.amount).toBe('0.01');
      expect(r.value.ibsCity?.amount).toBe('0.01');
    });

    it('uses only the first item and ignores the engine totals', () => {
      const f = load('ok-consultoria-2026');
      const body = JSON.parse(JSON.stringify(f.steps[0].response));
      const item = body.objetos[0];
      item.tribCalc.IBSCBS.gIBSCBS.vBC = '14.00';
      item.tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS = '0.13';
      (body.objetos as unknown[]).push(JSON.parse(JSON.stringify(item)));
      body.total.tribCalc.IBSCBSTot.gCBS.vCBS = '0.26';
      const r = mapper.fromCalcResponse(body, f.input, 'v');
      expect(r.ok && r.value.cbs?.amount).toBe('0.13');
    });
  });
});
