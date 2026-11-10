import {
  CodigoNaoNif,
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
import {
  resolveDpsLayout,
  type DpsLayoutPolicy,
  ACTIVE_LAYOUTS,
  type DpsLayout,
  XML_LAYOUT,
} from './dps-layout';
import { isNt009IbsCbsOnlyEvent } from './nt009-events';
import type { ForeignCustomer } from '../../foreign-customer';

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
function tribIssqnFor(
  _iss: Obligation,
  ibsCbsOnlyEvent: boolean,
): TipoTribISSQN {
  // NT 009 r1 events 99.02 to 99.04 are not ISSQN events (same rule as E0532).
  if (ibsCbsOnlyEvent) return TipoTribISSQN.NaoIncidencia;
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
    readonly customer:
      | {
          readonly kind: 'CPF' | 'CNPJ';
          readonly taxId: string;
          readonly name: string;
          readonly email?: string;
        }
      | {
          /** Customer outside Brazil: NIF (or the reason it has none) and the address abroad. */
          readonly kind: 'FOREIGN';
          readonly name: string;
          readonly email?: string;
          readonly foreign: ForeignCustomer;
        }
      | null;
    readonly discountAmount: DecimalString;
    /**
     * Issuer-declared deduction from the tax base. Sent as `vDedRed/vDR`; absent
     * or zero omits the group.
     */
    readonly deductionAmount?: DecimalString;
    /** Customer purchase order, sent as `serv/infoCompl/xPed`. */
    readonly purchaseOrder?: string;
    /** Complementary information, sent as `serv/infoCompl/xInfComp`. */
    readonly notes?: string;
  };
  readonly emitente: {
    readonly cnpj: string;
    readonly municipalReg: string | null;
    readonly municipalityCode: string;
    readonly specialTaxRegime: string | null;
    /** Effective ISS rate (%) of the Simples Nacional bracket, informed on the company (LC 123/2006, art. 21, §4º, I). */
    readonly simplesIssRate: string | null;
    /**
     * When present, the DPS carries the Simples approximate total tax rate
     * (`pTotTribSN`, ME/EPP) or `indTotTrib = 0` (MEI) and the profile's
     * `regApTribSN`, instead of a zeroed `vTotTrib`.
     */
    readonly simplesTotTrib?: {
      readonly regApTribSN: 1 | 2 | 3 | null;
      readonly totalRate: string | null;
    };
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
    policy: DpsLayoutPolicy = {},
  ): Promise<Result<DPS, FiscalError>> {
    const { result } = input;

    const configured = layoutId;
    if (configured === 'auto') {
      layoutId = resolveDpsLayout({
        ...policy,
        configured,
        sefinEnvironment: input.invoice.sefin ?? 'production',
        at: new Date(input.invoice.issuedAt),
      });
    }
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
    if (
      layout.status !== 'in_production' &&
      !(
        layout.id === 'nt009-r1' && layout.status === 'restricted_and_scheduled'
      )
    ) {
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

    // Explicit NT 009 remains restricted; auto resolves production only after
    // the cutover.
    if (
      layout.id === 'nt009-r1' &&
      input.invoice.environment === 'live' &&
      input.invoice.sefin !== 'restricted' &&
      configured !== 'auto'
    ) {
      return err(
        fiscalError({
          code: 'DPS_LAYOUT_UNSUPPORTED',
          message:
            "The DPS layout 'nt009-r1' is only enabled for the Sefin Produção Restrita",
          category: 'UNSUPPORTED',
          step: STEP,
          details: { layout: layout.id, reason: 'restricted_environment_only' },
        }),
      );
    }

    const serviceCode = result.classification.serviceCode;
    const ibsCbsOnlyEvent = isNt009IbsCbsOnlyEvent(serviceCode);
    if (ibsCbsOnlyEvent) {
      const violation =
        layout.id !== 'nt009-r1'
          ? 'layout_without_event'
          : result.applicability.issWithheld.status === 'REQUIRED'
            ? 'iss_withholding_not_allowed'
            : toDecimal(input.invoice.deductionAmount ?? '0').gt(0)
              ? 'iss_base_adjustment_not_allowed'
              : null;
      if (violation !== null) {
        return err(
          fiscalError({
            code:
              violation === 'layout_without_event'
                ? 'DPS_LAYOUT_UNSUPPORTED'
                : 'DPS_SCHEMA_VALIDATION_FAILED',
            message:
              violation === 'layout_without_event'
                ? `The service code ${serviceCode} (NT 009 item 99) requires the DPS layout 'nt009-r1'`
                : `The service code ${serviceCode} (NT 009 item 99) has no ISSQN incidence: ${violation}`,
            category:
              violation === 'layout_without_event'
                ? 'UNSUPPORTED'
                : 'VALIDATION',
            step: STEP,
            details: { layout: layout.id, serviceCode, reason: violation },
          }),
        );
      }
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
    // An IBS/CBS-only event without the IBSCBS group would carry no tax at all.
    if (ibscbsRequired || ibsCbsOnlyEvent) {
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
      !ibsCbsOnlyEvent &&
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
            'ISS withholding for Simples Nacional ME/EPP requires the effective ISS rate (pAliq) on the company',
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

    const simplesTotTrib = input.emitente.simplesTotTrib;
    if (
      simplesTotTrib !== undefined &&
      opSimpNac === OpcaoSimplesNacional.MeEpp &&
      simplesTotTrib.totalRate === null
    ) {
      return err(
        fiscalError({
          code: 'DPS_SCHEMA_VALIDATION_FAILED',
          message:
            'Simples Nacional ME/EPP requires the approximate total tax rate (pTotTribSN) on the company',
          category: 'VALIDATION',
          step: STEP,
          details: { reason: 'simples_total_rate_missing' },
        }),
      );
    }

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
                  simplesTotTrib?.regApTribSN != null
                    ? (String(
                        simplesTotTrib.regApTribSN,
                      ) as RegimeApuracaoSimplesNacional)
                    : RegimeApuracaoSimplesNacional.FederalEMunicipalPeloSN,
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
        cTribNac: serviceCode,
        ...(nbsCode !== null ? { cNBS: nbsCode } : {}),
        descricao: input.invoice.description,
        codMunicipioPrestacao: input.invoice.municipalityCode,
      },
      valores: {
        vServ: toDecimal(result.taxableAmounts.gross).toNumber(),
        ...(simplesRetentionRate !== null
          ? { aliqIss: Number(simplesRetentionRate) }
          : !ibsCbsOnlyEvent &&
              result.taxes.iss !== undefined &&
              result.taxes.iss.rate !== undefined
            ? { aliqIss: Number(result.taxes.iss.rate) }
            : {}),
        tribISSQN: tribIssqnFor(result.applicability.iss, ibsCbsOnlyEvent),
        tpRetISSQN,
        // The SDK picks the allowed `totTrib` member per regime (E0710/E0712):
        // indTotTrib 0 for MEI when nothing is informed, pTotTribSN for ME/EPP.
        ...(simplesTotTrib === undefined
          ? { vTotTrib: { vTotTribFed: 0, vTotTribEst: 0, vTotTribMun: 0 } }
          : opSimpNac === OpcaoSimplesNacional.MeEpp
            ? { pTotTribSN: Number(simplesTotTrib.totalRate) }
            : {}),
      },
      // A customer abroad is added after the assembly: the simple path only knows CPF and CNPJ.
      ...(input.invoice.customer !== null &&
      input.invoice.customer.kind !== 'FOREIGN'
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
    const deduction = toDecimal(input.invoice.deductionAmount ?? '0');
    if (deduction.gt(0)) {
      dps = {
        ...dps,
        infDPS: {
          ...dps.infDPS,
          valores: {
            ...dps.infDPS.valores,
            vDedRed: { vDR: deduction.toNumber() },
          },
        },
      };
    }
    if (input.invoice.customer?.kind === 'FOREIGN') {
      const { name, email, foreign } = input.invoice.customer;
      dps = {
        ...dps,
        infDPS: {
          ...dps.infDPS,
          toma: {
            identificador:
              foreign.taxId !== undefined
                ? { NIF: foreign.taxId }
                : {
                    cNaoNIF:
                      foreign.noTaxIdReason === 'exempt'
                        ? CodigoNaoNif.Dispensado
                        : CodigoNaoNif.NaoExigido,
                  },
            xNome: name,
            end: {
              localidade: {
                endExt: {
                  cPais: foreign.country,
                  cEndPost: foreign.postalCode,
                  xCidade: foreign.city,
                  xEstProvReg: foreign.region,
                },
              },
              xLgr: foreign.street,
              nro: foreign.number,
              ...(foreign.complement !== undefined
                ? { xCpl: foreign.complement }
                : {}),
              xBairro: foreign.district,
            },
            ...(email !== undefined ? { email } : {}),
          },
        },
      };
    }
    const { purchaseOrder, notes } = input.invoice;
    if (purchaseOrder !== undefined || notes !== undefined) {
      dps = {
        ...dps,
        infDPS: {
          ...dps.infDPS,
          serv: {
            ...dps.infDPS.serv,
            // Element order of TCInfoCompl: xPed comes before xInfComp.
            infoCompl: {
              ...(purchaseOrder !== undefined ? { xPed: purchaseOrder } : {}),
              ...(notes !== undefined ? { xInfComp: notes } : {}),
            },
          },
        },
      };
    }

    try {
      const xmlLayout = XML_LAYOUT[layout.id];
      const validation = await validateDpsXml(
        buildDpsXml(dps, { layout: xmlLayout }),
        { throwOnInvalid: false, layout: xmlLayout },
      );
      if (!validation.valid) {
        return err(
          fiscalError({
            code: 'DPS_SCHEMA_VALIDATION_FAILED',
            message: `The DPS XML failed schema validation for layout ${layout.id} (${validation.violations.length} violation(s))`,
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
          message: `The DPS XML could not be validated against layout ${layout.id}`,
          category: 'VALIDATION',
          step: STEP,
          details: sdkRejectionDetails('schema_validation_failed', error),
        }),
      );
    }

    return ok(dps);
  }
}
