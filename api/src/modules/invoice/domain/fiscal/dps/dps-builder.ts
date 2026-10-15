import {
  buildDps,
  buildDpsXml,
  FinalidadeNFSe,
  IndicadorDestinatario,
  OpcaoSimplesNacional,
  RegimeApuracaoSimplesNacional,
  RegimeEspecialTributacao,
  TipoAmbienteDps,
  TipoRetISSQN,
  TipoTribISSQN,
  validateDpsXml,
  type BuildDpsParams,
  type DPS,
  type RtcInfoIbsCbs,
} from 'open-nfse';
import type { FiscalCalculationResult } from '../fiscal-calculation-result';
import { fiscalError, type FiscalError } from '../fiscal-error';
import { toDecimal, type DecimalString } from '../money';
import { err, ok, type Result } from '../result';
import { ACTIVE_LAYOUTS, type DpsLayout } from './dps-layout';

const STEP = 'DpsBuilder';
const MAX_VIOLATIONS = 20;
/** CPF (11) and CNPJ (14) digit runs must never reach the error details. */
const PERSONAL_DATA_PATTERN = /\b\d{11,14}\b/g;

export interface DpsBuildInput {
  readonly result: FiscalCalculationResult;
  readonly invoice: {
    readonly number: string;
    readonly serie: string;
    readonly issuedAt: string;
    readonly competenceDate: string;
    readonly description: string;
    readonly municipalityCode: string;
    readonly environment: 'live' | 'test';
    readonly customer: {
      readonly kind: 'CPF' | 'CNPJ';
      readonly taxId: string;
      readonly name: string;
      readonly email?: string;
    } | null;
    readonly discountAmount: DecimalString;
  };
  readonly emitente: {
    readonly cnpj: string;
    readonly municipalReg: string | null;
    readonly municipalityCode: string;
    readonly specialTaxRegime: string | null;
  };
}

const sdkRejectionDetails = (
  reason: string,
  error: unknown,
): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return { reason, errorName: 'unknown_error' };
  }
  const rule = (error as unknown as { readonly rule?: unknown }).rule;
  return typeof rule === 'string'
    ? { reason, errorName: error.name, rule }
    : { reason, errorName: error.name };
};

const redactViolations = (
  violations: readonly { readonly message: string; readonly line?: number }[],
): readonly { readonly message: string; readonly line?: number }[] =>
  violations
    .slice(0, MAX_VIOLATIONS)
    .map((violation) => ({
      message: violation.message.replace(PERSONAL_DATA_PATTERN, '[redacted]'),
      ...(violation.line !== undefined ? { line: violation.line } : {}),
    }));

/**
 * Translates a `FiscalCalculationResult` into a typed DPS (RTC v1.01). It
 * decides nothing fiscal — regime, classification and applicability come from
 * the engine; this builder only maps them onto the layout and rejects the
 * inputs the layout cannot represent. Errors are `Result` values, never
 * thrown.
 */
export class DpsBuilder {
  private readonly layouts: Readonly<Record<string, DpsLayout>>;

  constructor(layouts: Readonly<Record<string, DpsLayout>> = ACTIVE_LAYOUTS) {
    this.layouts = layouts;
  }

  async build(
    input: DpsBuildInput,
    layoutId: string,
  ): Promise<Result<DPS, FiscalError>> {
    const { result } = input;

    const layout: DpsLayout | undefined = this.layouts[layoutId];
    if (layout === undefined) {
      return err(
        fiscalError({
          code: 'DPS_LAYOUT_UNSUPPORTED',
          message: `The DPS layout '${layoutId}' is not registered for this environment`,
          category: 'UNSUPPORTED',
          step: STEP,
          details: { layout: layoutId },
        }),
      );
    }
    if (layout.status !== 'in_production') {
      return err(
        fiscalError({
          code: 'DPS_LAYOUT_UNSUPPORTED',
          message: `The DPS layout '${layoutId}' is not in production (status '${layout.status}')`,
          category: 'UNSUPPORTED',
          step: STEP,
          details: { layout: layoutId, status: layout.status },
        }),
      );
    }

    if (
      input.invoice.customer === null &&
      result.applicability.customerRequired
    ) {
      return err(
        fiscalError({
          code: 'DPS_SCHEMA_VALIDATION_FAILED',
          message:
            'The fiscal applicability requires a tomador but the invoice carries no customer',
          category: 'VALIDATION',
          step: STEP,
          details: { reason: 'tomador_required' },
        }),
      );
    }

    const { nbsCode, cst, classCode, operationIndicator } =
      result.classification;
    const ibscbsRequired =
      result.applicability.cbs.status === 'REQUIRED' ||
      result.applicability.ibs.status === 'REQUIRED';
    let ibscbs: RtcInfoIbsCbs | undefined;
    if (ibscbsRequired) {
      if (
        nbsCode === null ||
        cst === null ||
        classCode === null ||
        operationIndicator === null
      ) {
        return err(
          fiscalError({
            code: 'DPS_SCHEMA_VALIDATION_FAILED',
            message:
              'The fiscal classification is incomplete for the mandatory IBSCBS group',
            category: 'VALIDATION',
            step: STEP,
            details: {
              reason: 'classification_incomplete_for_ibscbs',
              missingFields: [
                ...(nbsCode === null ? ['nbsCode'] : []),
                ...(cst === null ? ['cst'] : []),
                ...(classCode === null ? ['classCode'] : []),
                ...(operationIndicator === null
                  ? ['operationIndicator']
                  : []),
              ],
            },
          }),
        );
      }
      ibscbs = {
        finNFSe: FinalidadeNFSe.Regular,
        cIndOp: operationIndicator,
        indDest: IndicadorDestinatario.TomadorEhDestinatario,
        valores: {
          trib: { gIBSCBS: { CST: cst, cClassTrib: classCode } },
        },
      };
    }

    const opSimpNac =
      result.taxRegime === 'MEI'
        ? OpcaoSimplesNacional.Mei
        : result.taxRegime === 'SIMPLES_NACIONAL'
          ? OpcaoSimplesNacional.MeEpp
          : OpcaoSimplesNacional.NaoOptante;

    const params: BuildDpsParams = {
      emitente: {
        cnpj: input.emitente.cnpj,
        codMunicipio: input.emitente.municipalityCode,
        regime: {
          opSimpNac,
          regEspTrib: String(
            Number(input.emitente.specialTaxRegime ?? 0),
          ) as RegimeEspecialTributacao,
          ...(opSimpNac === OpcaoSimplesNacional.MeEpp
            ? {
                regApTribSN:
                  RegimeApuracaoSimplesNacional.FederalEMunicipalPeloSN,
              }
            : {}),
        },
        ...(input.emitente.municipalReg !== null
          ? { inscricaoMunicipal: input.emitente.municipalReg }
          : {}),
      },
      serie: input.invoice.serie,
      nDPS: input.invoice.number,
      tpAmb:
        input.invoice.environment === 'live'
          ? TipoAmbienteDps.Producao
          : TipoAmbienteDps.Homologacao,
      dhEmi: new Date(input.invoice.issuedAt),
      dCompet: new Date(
        `${input.invoice.competenceDate.slice(0, 10)}T12:00:00Z`,
      ),
      verAplic: input.invoice.environment === 'live' ? 'Corvo' : 'Corvo-test',
      servico: {
        cTribNac: result.classification.serviceCode,
        ...(nbsCode !== null ? { cNBS: nbsCode } : {}),
        descricao: input.invoice.description,
        codMunicipioPrestacao: input.invoice.municipalityCode,
      },
      valores: {
        vServ: toDecimal(result.taxableAmounts.gross).toNumber(),
        ...(result.taxes.iss !== undefined &&
        result.taxes.iss.rate !== undefined
          ? { aliqIss: Number(result.taxes.iss.rate) }
          : {}),
        tribISSQN: TipoTribISSQN.OperacaoTributavel,
        tpRetISSQN:
          result.applicability.issWithheld.status === 'REQUIRED'
            ? TipoRetISSQN.RetidoPeloTomador
            : TipoRetISSQN.NaoRetido,
        vTotTrib: { vTotTribFed: 0, vTotTribEst: 0, vTotTribMun: 0 },
      },
      ...(input.invoice.customer !== null
        ? {
            tomador: {
              documento:
                input.invoice.customer.kind === 'CNPJ'
                  ? { CNPJ: input.invoice.customer.taxId }
                  : { CPF: input.invoice.customer.taxId },
              nome: input.invoice.customer.name,
              ...(input.invoice.customer.email !== undefined
                ? { email: input.invoice.customer.email }
                : {}),
            },
          }
        : {}),
      skipCpfCnpjValidation: false,
    };

    let dps: DPS;
    try {
      dps = buildDps(params);
    } catch (error: unknown) {
      return err(
        fiscalError({
          code: 'DPS_SCHEMA_VALIDATION_FAILED',
          message: 'open-nfse rejected the DPS assembly',
          category: 'VALIDATION',
          step: STEP,
          details: sdkRejectionDetails('build_rejected', error),
        }),
      );
    }

    if (ibscbs !== undefined) {
      dps = { ...dps, infDPS: { ...dps.infDPS, IBSCBS: ibscbs } };
    }
    const discount = toDecimal(input.invoice.discountAmount);
    if (discount.gt(0)) {
      dps = {
        ...dps,
        infDPS: {
          ...dps.infDPS,
          valores: {
            ...dps.infDPS.valores,
            vDescCondIncond: { vDescIncond: discount.toNumber() },
          },
        },
      };
    }

    try {
      const validation = await validateDpsXml(buildDpsXml(dps), {
        throwOnInvalid: false,
      });
      if (!validation.valid) {
        return err(
          fiscalError({
            code: 'DPS_SCHEMA_VALIDATION_FAILED',
            message: `The DPS XML failed RTC v1.01 schema validation (${validation.violations.length} violation(s))`,
            category: 'VALIDATION',
            step: STEP,
            details: { violations: redactViolations(validation.violations) },
          }),
        );
      }
    } catch (error: unknown) {
      return err(
        fiscalError({
          code: 'DPS_SCHEMA_VALIDATION_FAILED',
          message: 'The DPS XML could not be validated against RTC v1.01',
          category: 'VALIDATION',
          step: STEP,
          details: sdkRejectionDetails('schema_validation_failed', error),
        }),
      );
    }

    return ok(dps);
  }
}
