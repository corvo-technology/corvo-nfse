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
import { SPECIAL_TAX_REGIME_CODES } from '@/modules/company/domain/fiscal-profile';
import type { Obligation } from '../applicability/tax-applicability';
import type { FiscalCalculationResult } from '../fiscal-calculation-result';
import { fiscalError, type FiscalError } from '../fiscal-error';
import { toDecimal, type DecimalString } from '../money';
import { err, ok, type Result } from '../result';
import { ACTIVE_LAYOUTS, type DpsLayout } from './dps-layout';

const STEP = 'DpsBuilder';
const MAX_VIOLATIONS = 20;
/** CPF (11) and CNPJ (14) digit runs must never reach the error details. */
const PERSONAL_DATA_PATTERN = /\b\d{11,14}\b/g;

/**
 * RTC v1.01 `tribISSQN` from the ISS applicability the fiscal engine
 * already decided. Only "operação tributável" (1) is modelled: isenção is
 * not a `tribISSQN` value, it is the municipal benefit group (BM/nBM),
 * which blocks emission upstream as UNSUPPORTED before this builder runs.
 * Imunidade (2, needs tpImunidade), exportação de serviço (3, needs
 * cPaisResult) and não incidência (4) are not modelled either — this is the
 * single place to add them once the engine can produce those extra fields.
 */
function tribIssqnFor(_iss: Obligation): TipoTribISSQN {
  return TipoTribISSQN.OperacaoTributavel;
}

/**
 * `regEspTrib` (RTC v1.01 `TSRegEspTrib`) from the stored special tax
 * regime. Rejects free text that predates this validation (old rows may
 * still hold it) and enforces E0174 (MEI) / E0175 (ME/EPP via Simples
 * Nacional, the only `regApTribSN` Corvo sends): both require regEspTrib=0.
 */
function resolveRegEspTrib(
  specialTaxRegime: string | null,
  opSimpNac: OpcaoSimplesNacional,
): Result<RegimeEspecialTributacao, FiscalError> {
  const raw = specialTaxRegime?.trim() || '0';
  // Numeric rows stored before this validation (e.g. "03") keep working.
  const code = /^\d{1,2}$/.test(raw) ? String(Number(raw)) : raw;
  if (!(SPECIAL_TAX_REGIME_CODES as readonly string[]).includes(code)) {
    return err(
      fiscalError({
        code: 'FISCAL_VALIDATION_FAILED',
        message: `O regime especial de tributação "${code}" não é um código regEspTrib válido (0 a 6)`,
        category: 'VALIDATION',
        step: STEP,
        details: { reason: 'special_tax_regime_invalid', value: code },
      }),
    );
  }
  const isSimplesLike =
    opSimpNac === OpcaoSimplesNacional.Mei ||
    opSimpNac === OpcaoSimplesNacional.MeEpp;
  if (code !== '0' && isSimplesLike) {
    const rule = opSimpNac === OpcaoSimplesNacional.Mei ? 'E0174' : 'E0175';
    return err(
      fiscalError({
        code: 'FISCAL_VALIDATION_FAILED',
        message: `opSimpNac=${opSimpNac} exige regEspTrib=0; recebido "${code}" (${rule})`,
        category: 'VALIDATION',
        step: STEP,
        details: {
          reason: 'special_tax_regime_incompatible_with_simples',
          opSimpNac,
          value: code,
          rule,
        },
      }),
    );
  }
  return ok(code as RegimeEspecialTributacao);
}

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
    /**
     * Where the DPS is received. A live invoice sent to the Sefin Produção Restrita must carry
     * the homologation `tpAmb`, otherwise the Receita rejects it (E0006).
     */
    readonly sefin?: 'production' | 'restricted';
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
    /** Effective ISS rate (%) of the Simples Nacional bracket of the previous month (LC 123/2006, art. 21, §4º, I). */
    readonly simplesIssRate: string | null;
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
  violations.slice(0, MAX_VIOLATIONS).map((violation) => ({
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
                ...(operationIndicator === null ? ['operationIndicator'] : []),
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

    const tpRetISSQN =
      result.applicability.issWithheld.status === 'REQUIRED'
        ? TipoRetISSQN.RetidoPeloTomador
        : TipoRetISSQN.NaoRetido;
    // The Simples Nacional ME/EPP ISS rate only goes on the DPS when
    // retention applies (Sefin 656/658 mandate pAliq for tpRetISSQN 2/3); the
    // engine blocks emission beforehand when retention is required and the
    // rate is missing, so this never silently sends a zeroed rate.
    const simplesRetentionRate =
      opSimpNac === OpcaoSimplesNacional.MeEpp &&
      tpRetISSQN === TipoRetISSQN.RetidoPeloTomador
        ? input.emitente.simplesIssRate
        : null;
    if (
      opSimpNac === OpcaoSimplesNacional.MeEpp &&
      tpRetISSQN === TipoRetISSQN.RetidoPeloTomador &&
      simplesRetentionRate === null
    ) {
      return err(
        fiscalError({
          code: 'DPS_SCHEMA_VALIDATION_FAILED',
          message:
            'ISS withholding for Simples Nacional ME/EPP requires the effective ISS rate (pAliq) on the fiscal profile',
          category: 'VALIDATION',
          step: STEP,
          details: { reason: 'simples_iss_rate_missing' },
        }),
      );
    }
    const regEspTrib = resolveRegEspTrib(
      input.emitente.specialTaxRegime,
      opSimpNac,
    );
    if (!regEspTrib.ok) return err(regEspTrib.error);

    const params: BuildDpsParams = {
      emitente: {
        cnpj: input.emitente.cnpj,
        codMunicipio: input.emitente.municipalityCode,
        regime: {
          opSimpNac,
          regEspTrib: regEspTrib.value,
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
        input.invoice.environment === 'live' &&
        input.invoice.sefin !== 'restricted'
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
        ...(simplesRetentionRate !== null
          ? { aliqIss: Number(simplesRetentionRate) }
          : result.taxes.iss !== undefined &&
              result.taxes.iss.rate !== undefined
            ? { aliqIss: Number(result.taxes.iss.rate) }
            : {}),
        tribISSQN: tribIssqnFor(result.applicability.iss),
        tpRetISSQN,
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
