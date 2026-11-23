import {
  fiscalError,
  type FiscalError,
} from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { Decimal } from '@/modules/invoice/domain/fiscal/money';
import { moneyString, toDecimal } from '@/modules/invoice/domain/fiscal/money';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import type { TaxAmount } from '@/modules/invoice/domain/fiscal/tax-amount';
import type { RtcCalculationInput } from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';
import { ufFromIbge } from '@/shared/fiscal/ibge-uf';
import type { RtcMapper } from './rtc-mapper';

const STEP_NAME = 'RtcTaxCalculator';
const CALC_VERSION = '1.0.0';
const FACT_TIME_SUFFIX = 'T12:00:00Z';
/** A Calculadora exige um id de correlação por requisição de cálculo. */
const PREVIEW_ID = 'preview';

type GroupFields = {
  readonly rate: string;
  readonly amount: string;
};

const invalidResponse = (path: string, detail: string): FiscalError =>
  fiscalError({
    code: 'FISCAL_VALIDATION_FAILED',
    message: `Invalid RTC calculator response at ${path}: ${detail}`,
    category: 'CALCULATION',
    step: STEP_NAME,
    details: { reason: 'rtc_invalid_response', path, detail },
    retryable: false,
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Decimal não negativo e finito a partir da resposta do motor (nunca float). */
const parseAmount = (value: unknown): Decimal | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const parsed = toDecimal(value);
    return parsed.isFinite() && !parsed.isNegative() ? parsed : null;
  } catch {
    return null;
  }
};

const rateText = (value: unknown): string =>
  typeof value === 'string' ? value : String(value);

const missing = (path: string): FiscalError =>
  invalidResponse(path, 'required value is missing, non-numeric or negative');

/**
 * Um grupo (gCBS, gIBSUF, gIBSMun) de `gIBSCBS` em `TaxAmount`, com a
 * convenção do motor: base comum em `gIBSCBS.vBC`, alíquota nominal em
 * `pXxx`, alíquota efetiva (`gRed.pAliqEfet ?? nominal`), redução
 * (`gRed.pRedAliq ?? '0'`) e valores sempre em string decimal.
 */
const taxAmountOf = (
  group: Record<string, unknown>,
  path: string,
  base: Decimal,
  fields: GroupFields,
): Result<TaxAmount, FiscalError> => {
  const rawRate = group[fields.rate];
  const rate = parseAmount(rawRate);
  if (rate === null) return err(missing(`${path}.${fields.rate}`));
  const amount = parseAmount(group[fields.amount]);
  if (amount === null) return err(missing(`${path}.${fields.amount}`));

  let effectiveRate = rateText(rawRate);
  let reductionRate = '0';
  if (group.gRed !== undefined && group.gRed !== null) {
    const gRed = asRecord(group.gRed);
    if (gRed === null)
      return err(invalidResponse(`${path}.gRed`, 'expected an object'));
    if (gRed.pAliqEfet !== undefined && gRed.pAliqEfet !== null) {
      const effective = parseAmount(gRed.pAliqEfet);
      if (effective === null) return err(missing(`${path}.gRed.pAliqEfet`));
      effectiveRate = rateText(gRed.pAliqEfet);
    }
    if (gRed.pRedAliq !== undefined && gRed.pRedAliq !== null) {
      const reduction = parseAmount(gRed.pRedAliq);
      if (reduction === null) return err(missing(`${path}.gRed.pRedAliq`));
      reductionRate = rateText(gRed.pRedAliq);
    }
  }

  return ok({
    base: moneyString(base),
    rate: rateText(rawRate),
    effectiveRate,
    reductionRate,
    amount: moneyString(amount),
  });
};

/** Qualquer diferimento (`gDif`) com valor é fora do contrato da Corvo. */
const deferralErrorOf = (
  group: Record<string, unknown>,
  path: string,
): FiscalError | null => {
  const gDif = group.gDif;
  if (gDif === undefined || gDif === null) return null;
  const deferral = asRecord(gDif);
  if (deferral === null)
    return invalidResponse(`${path}.gDif`, 'expected an object');
  for (const field of ['pDif', 'vDif']) {
    const raw = deferral[field];
    const parsed = parseAmount(raw);
    if (parsed === null) return missing(`${path}.gDif.${field}`);
    if (!parsed.isZero()) {
      return fiscalError({
        code: 'TAX_CALCULATION_UNSUPPORTED',
        message: 'Deferred IBS/CBS (gDif) is not supported',
        category: 'UNSUPPORTED',
        step: STEP_NAME,
        details: { reason: 'deferral_not_supported', path: `${path}.gDif` },
        retryable: false,
      });
    }
  }
  return null;
};

/**
 * `RtcMapper` do contrato oficial verificado (`docs/fiscal/rtc/README.md` e
 * fixtures reais em `docs/fiscal/rtc/fixtures/`). Converte o input de domínio
 * nos corpos aceitos pela Calculadora — a base da NFS-e primeiro (deduz ISS
 * em 2026; nunca PIS/COFINS) e o cálculo do regime-geral depois (nunca
 * `aliquotasNominais`) — e mapeia a resposta tipada, rejeitando resultados
 * simulados, diferimentos e corpos fora do contrato.
 */
export class DefaultRtcMapper implements RtcMapper {
  toBaseRequest(input: RtcCalculationInput): {
    path: '/calculadora/nfse/base-calculo';
    body: unknown;
  } {
    const body: Record<string, number> = {
      anoFatoGerador: Number(input.competenceDate.slice(0, 4)),
      valorServico: toDecimal(input.grossAmount).toNumber(),
    };
    const discount = toDecimal(input.discountAmount);
    if (!discount.isZero()) body.descontoIncondicional = discount.toNumber();
    if (input.issAmount !== null) {
      body.iss = toDecimal(input.issAmount).toNumber();
    }
    return { path: '/calculadora/nfse/base-calculo', body };
  }

  fromBaseResponse(body: unknown): Result<string, FiscalError> {
    const record = asRecord(body);
    const baseCalculo =
      record === null ? null : parseAmount(record.baseCalculo);
    if (baseCalculo === null) return err(missing('baseCalculo'));
    return ok(moneyString(baseCalculo));
  }

  toCalcRequest(
    input: RtcCalculationInput,
    baseCalculo: string,
  ): { path: '/calculadora/regime-geral'; body: unknown } {
    const body: Record<string, unknown> = {
      id: PREVIEW_ID,
      versao: CALC_VERSION,
      dhFatoGerador: `${input.competenceDate}${FACT_TIME_SUFFIX}`,
      municipio: Number(input.incidenceMunicipalityCode),
      itens: [
        {
          numero: 1,
          nbs: input.nbsCode,
          cst: input.cst,
          cClassTrib: input.classCode,
          baseCalculo: toDecimal(baseCalculo).toNumber(),
        },
      ],
    };
    const uf = ufFromIbge(input.incidenceMunicipalityCode);
    if (uf !== null) body.uf = uf;
    return { path: '/calculadora/regime-geral', body };
  }

  fromCalcResponse(
    body: unknown,
    _input: RtcCalculationInput,
    calculatorVersion: string,
  ): Result<RtcTaxResult, FiscalError> {
    const root = asRecord(body);
    const objetos = root?.objetos;
    if (!Array.isArray(objetos) || objetos.length === 0) {
      return err(invalidResponse('objetos', 'expected a non-empty array'));
    }
    const item = asRecord(objetos[0]);
    if (item === null) {
      return err(invalidResponse('objetos[0]', 'expected an object'));
    }
    if (item.calculoSimulado === true) {
      return err(
        fiscalError({
          code: 'TAX_RATE_NOT_FOUND',
          message:
            'The RTC engine answered with a simulated result (calculoSimulado) instead of nominal rates',
          category: 'CONFIGURATION',
          step: STEP_NAME,
          details: { reason: 'simulated_result' },
          retryable: false,
        }),
      );
    }

    const ibscbsPath = 'objetos[0].tribCalc.IBSCBS.gIBSCBS';
    const tribCalc = asRecord(item.tribCalc);
    const ibscbs = tribCalc === null ? null : asRecord(tribCalc.IBSCBS);
    const group = ibscbs === null ? null : asRecord(ibscbs.gIBSCBS);
    if (group === null) {
      return err(
        invalidResponse(
          ibscbsPath,
          'missing objetos[0].tribCalc.IBSCBS.gIBSCBS',
        ),
      );
    }

    const gCBS = asRecord(group.gCBS);
    const gIBSUF = asRecord(group.gIBSUF);
    const gIBSMun = asRecord(group.gIBSMun);
    if (gCBS === null || gIBSUF === null || gIBSMun === null) {
      return err(
        invalidResponse(ibscbsPath, 'expected gCBS, gIBSUF and gIBSMun groups'),
      );
    }
    for (const [g, path] of [
      [gCBS, `${ibscbsPath}.gCBS`],
      [gIBSUF, `${ibscbsPath}.gIBSUF`],
      [gIBSMun, `${ibscbsPath}.gIBSMun`],
    ] as const) {
      const deferred = deferralErrorOf(g, path);
      if (deferred !== null) return err(deferred);
    }

    const base = parseAmount(group.vBC);
    if (base === null) return err(missing(`${ibscbsPath}.vBC`));
    const ibs = parseAmount(group.vIBS);
    if (ibs === null) return err(missing(`${ibscbsPath}.vIBS`));

    const cbs = taxAmountOf(gCBS, `${ibscbsPath}.gCBS`, base, {
      rate: 'pCBS',
      amount: 'vCBS',
    });
    if (!cbs.ok) return cbs;
    const ibsState = taxAmountOf(gIBSUF, `${ibscbsPath}.gIBSUF`, base, {
      rate: 'pIBSUF',
      amount: 'vIBSUF',
    });
    if (!ibsState.ok) return ibsState;
    const ibsCity = taxAmountOf(gIBSMun, `${ibscbsPath}.gIBSMun`, base, {
      rate: 'pIBSMun',
      amount: 'vIBSMun',
    });
    if (!ibsCity.ok) return ibsCity;

    // Até a 1.7.0 cada grupo trazia a sua memoriaCalculo; a partir da 1.7.2 ela vem
    // num objeto único em gIBSCBS.memoriaCalculo ({ cbs, ibsUF, ibsMun }).
    const memory = asRecord(group.memoriaCalculo);

    return ok({
      calculatorVersion,
      cbs: cbs.value,
      ibsState: ibsState.value,
      ibsCity: ibsCity.value,
      ibsTotal: { base: moneyString(base), amount: moneyString(ibs) },
      legalReferences: [],
      calculationMemory: [
        gCBS.memoriaCalculo ?? memory?.cbs,
        gIBSUF.memoriaCalculo ?? memory?.ibsUF,
        gIBSMun.memoriaCalculo ?? memory?.ibsMun,
      ],
      collectionWaived: false,
    });
  }

  fromProblem(status: number, body: unknown): FiscalError | null {
    const record = asRecord(body);
    const type =
      record !== null && typeof record.type === 'string' ? record.type : '';
    if (
      type.endsWith('aliquotas-nominais-nao-informadas') ||
      type.endsWith('aliquota-nao-encontrada')
    ) {
      return fiscalError({
        code: 'TAX_RATE_NOT_FOUND',
        message: `The RTC engine has no nominal rates for this operation yet (HTTP ${status})`,
        category: 'CONFIGURATION',
        step: STEP_NAME,
        details: { status, type },
        retryable: false,
      });
    }
    if (type.endsWith('classificacao-tributaria-nao-encontrada')) {
      return fiscalError({
        code: 'FISCAL_CLASSIFICATION_INVALID',
        message: `The RTC engine does not know this tax classification (HTTP ${status})`,
        category: 'CLASSIFICATION',
        step: STEP_NAME,
        details: { status, type },
        retryable: false,
      });
    }
    return null;
  }
}
