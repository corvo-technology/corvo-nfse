import {
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
  type DPS,
} from 'open-nfse';
import type {
  Obligation,
  TaxApplicability,
} from '../applicability/tax-applicability';
import type { ServiceTaxClassification } from '../classification/service-tax-classification';
import type { FiscalCalculationResult } from '../fiscal-calculation-result';
import type { FiscalError } from '../fiscal-error';
import type { Result } from '../result';
import { DpsBuilder, type DpsBuildInput } from './dps-builder';

const RTC_V1_01 = 'rtc-v1.01';
const MUNICIPIO_SP = '3550308';
/** Real catalog codes from docs/fiscal/rtc/fixtures/ok-consultoria-2026.json. */
const REAL_NBS = '115011000';
const REAL_CST = '000';
const REAL_CLASS_CODE = '000001';
const REAL_OPERATION_INDICATOR = '100301';

const REQUIRED: Obligation = { status: 'REQUIRED' };
const na = (reason: string): Obligation => ({
  status: 'NOT_APPLICABLE',
  reason,
});

/**
 * Classification whose codes are synthetic but well-formed for the RTC XSD
 * patterns (6/9/3/6 digits). Only structural tests use these — XSD validity is
 * always asserted with the real catalog codes above.
 */
const classification = (
  overrides: Partial<ServiceTaxClassification> = {},
): ServiceTaxClassification => ({
  serviceCode: '010601',
  municipalServiceCode: null,
  nbsCode: '010601001',
  cst: '000',
  classCode: '060101',
  operationIndicator: '000000',
  source: 'company_service_profile',
  serviceProfileId: 'sp-1',
  operationNature: 'SERVICE',
  iss: {
    taxation: 'NORMAL',
    rate: '3',
    withholdingDefault: false,
    incidenceMunicipalityCode: MUNICIPIO_SP,
  },
  withholding: { policy: 'NONE_CONFIRMED', rates: {} },
  catalogVersions: { nbs: '2026.1' },
  catalogValidated: true,
  justification: 'company service profile',
  ...overrides,
});

const applicability = (
  overrides: Partial<TaxApplicability> = {},
): TaxApplicability => ({
  strategy: 'regular',
  customerRequired: true,
  iss: REQUIRED,
  issWithheld: na('no ISS withholding configured'),
  federalWithholding: na('NONE_CONFIRMED policy'),
  cbs: REQUIRED,
  ibs: REQUIRED,
  specialTreatment: na('no special treatment'),
  collectionWaived: false,
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 214/2025', 'LC 116/2003'],
  ...overrides,
});

const fiscalResult = (
  overrides: Partial<FiscalCalculationResult> = {},
): FiscalCalculationResult => ({
  operationId: 'inv-1',
  companyId: 'comp-1',
  competenceDate: '2026-12-10',
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: 'cfp-1',
  classification: classification(),
  taxableAmounts: { gross: '1000.00', discount: '0.00' },
  taxes: { iss: { base: '1000.00', rate: '3', amount: '30.00' } },
  withholdings: [],
  netReceivableAmount: '970.00',
  applicability: applicability(),
  collectionWaived: false,
  calculationSource: 'legacy',
  calculatorVersion: null,
  catalogVersions: { nbs: '2026.1' },
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 116/2003'],
  warnings: [],
  requiresReview: false,
  trace: [],
  calculationMemory: [],
  ...overrides,
});

interface DpsInputOverrides {
  readonly result?: Partial<FiscalCalculationResult>;
  readonly invoice?: Partial<DpsBuildInput['invoice']>;
  readonly emitente?: Partial<DpsBuildInput['emitente']>;
}

const input = (overrides: DpsInputOverrides = {}): DpsBuildInput => ({
  result: fiscalResult(overrides.result),
  invoice: {
    number: '1',
    serie: '1',
    issuedAt: '2026-12-10T12:00:00.000Z',
    competenceDate: '2026-12-10',
    description: 'Consultoria em TI',
    municipalityCode: MUNICIPIO_SP,
    environment: 'test',
    customer: {
      kind: 'CNPJ',
      taxId: '12345678000195',
      name: 'Cliente Teste LTDA',
    },
    discountAmount: '0.00',
    ...overrides.invoice,
  },
  emitente: {
    cnpj: '11222333000181',
    municipalReg: null,
    municipalityCode: MUNICIPIO_SP,
    specialTaxRegime: null,
    simplesIssRate: null,
    ...overrides.emitente,
  },
});

const dpsFrom = (result: Result<DPS, FiscalError>): DPS => {
  if (!result.ok) {
    throw new Error(
      `expected a DPS, got ${result.error.code}: ${result.error.message}`,
    );
  }
  return result.value;
};

const errorFrom = (result: Result<DPS, FiscalError>): FiscalError => {
  if (result.ok) {
    throw new Error('expected a DPS build failure, got a DPS');
  }
  return result.error;
};

describe('DpsBuilder', () => {
  it('builds a DPS with Mei regime and no IBSCBS group', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: {
            taxRegime: 'MEI',
            taxes: {},
            applicability: applicability({
              strategy: 'mei',
              customerRequired: false,
              iss: na('ISS recolhido no DAS-MEI'),
              cbs: na('MEI nao destaca IBS/CBS na fase de teste'),
              ibs: na('MEI nao destaca IBS/CBS na fase de teste'),
            }),
          },
        }),
        RTC_V1_01,
      ),
    );

    expect(dps.infDPS.prest.regTrib.opSimpNac).toBe(OpcaoSimplesNacional.Mei);
    expect(dps.infDPS.prest.regTrib.regApTribSN).toBeUndefined();
    expect(dps.infDPS.prest.regTrib.regEspTrib).toBe(
      RegimeEspecialTributacao.Nenhum,
    );
    expect(dps.infDPS.IBSCBS).toBeUndefined();
    expect(dps.infDPS.valores.vServPrest.vServ).toBe(1000);
    expect(dps.infDPS.valores.trib.totTrib).toEqual({
      vTotTrib: { vTotTribFed: 0, vTotTribEst: 0, vTotTribMun: 0 },
    });
    expect(dps.infDPS.tpAmb).toBe(TipoAmbienteDps.Homologacao);
    expect(dps.infDPS.verAplic).toBe('Corvo-test');
  });

  describe('tpAmb follows where the DPS is received (Receita E0006)', () => {
    const tpAmbOf = async (invoice: DpsInputOverrides['invoice']) =>
      dpsFrom(await new DpsBuilder().build(input({ invoice }), RTC_V1_01))
        .infDPS.tpAmb;

    it('marks a live invoice as production by default', async () => {
      expect(await tpAmbOf({ environment: 'live' })).toBe(
        TipoAmbienteDps.Producao,
      );
      expect(await tpAmbOf({ environment: 'live', sefin: 'production' })).toBe(
        TipoAmbienteDps.Producao,
      );
    });

    it('marks a live invoice as homologation when it goes to the Produção Restrita', async () => {
      expect(await tpAmbOf({ environment: 'live', sefin: 'restricted' })).toBe(
        TipoAmbienteDps.Homologacao,
      );
    });

    it('keeps a test invoice in homologation whatever the target is', async () => {
      expect(await tpAmbOf({ environment: 'test', sefin: 'production' })).toBe(
        TipoAmbienteDps.Homologacao,
      );
    });
  });

  it('builds a DPS with MeEpp regime and SN federal/municipal apuration', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: { taxRegime: 'SIMPLES_NACIONAL', taxes: {} },
          emitente: { specialTaxRegime: '2' },
        }),
        RTC_V1_01,
      ),
    );

    expect(dps.infDPS.prest.regTrib.opSimpNac).toBe(OpcaoSimplesNacional.MeEpp);
    expect(dps.infDPS.prest.regTrib.regApTribSN).toBe(
      RegimeApuracaoSimplesNacional.FederalEMunicipalPeloSN,
    );
    expect(dps.infDPS.prest.regTrib.regEspTrib).toBe(
      RegimeEspecialTributacao.Estimativa,
    );
  });

  describe('Simples Nacional ISS withholding rate (pAliq)', () => {
    it('carries pAliq with the Simples ISS rate when retention is required', async () => {
      const dps = dpsFrom(
        await new DpsBuilder().build(
          input({
            result: {
              taxRegime: 'SIMPLES_NACIONAL',
              taxes: {},
              applicability: applicability({ issWithheld: REQUIRED }),
            },
            emitente: { simplesIssRate: '2.01' },
          }),
          RTC_V1_01,
        ),
      );
      expect(dps.infDPS.valores.trib.tribMun.pAliq).toBe(2.01);
      expect(dps.infDPS.valores.trib.tribMun.tpRetISSQN).toBe(
        TipoRetISSQN.RetidoPeloTomador,
      );
    });

    it('refuses Simples Nacional ISS retention when the rate is missing at emission', async () => {
      const error = errorFrom(
        await new DpsBuilder().build(
          input({
            result: {
              taxRegime: 'SIMPLES_NACIONAL',
              taxes: {},
              applicability: applicability({ issWithheld: REQUIRED }),
            },
            emitente: { simplesIssRate: null },
          }),
          RTC_V1_01,
        ),
      );
      expect(error.details).toMatchObject({
        reason: 'simples_iss_rate_missing',
      });
    });

    it('omits pAliq for Simples Nacional without ISS retention even when the rate is set', async () => {
      const dps = dpsFrom(
        await new DpsBuilder().build(
          input({
            result: { taxRegime: 'SIMPLES_NACIONAL', taxes: {} },
            emitente: { simplesIssRate: '2.01' },
          }),
          RTC_V1_01,
        ),
      );
      expect(dps.infDPS.valores.trib.tribMun.pAliq).toBeUndefined();
    });

    it('keeps the regular-regime aliqIss from the calculated ISS rate regardless of simplesIssRate', async () => {
      const dps = dpsFrom(
        await new DpsBuilder().build(
          input({ emitente: { simplesIssRate: '2.01' } }),
          RTC_V1_01,
        ),
      );
      expect(dps.infDPS.valores.trib.tribMun.pAliq).toBe(3);
    });
  });

  it('builds the declarative IBSCBS group with real catalog codes and passes XSD validation', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: {
            taxes: {},
            classification: classification({
              nbsCode: REAL_NBS,
              cst: REAL_CST,
              classCode: REAL_CLASS_CODE,
              operationIndicator: REAL_OPERATION_INDICATOR,
            }),
          },
        }),
        RTC_V1_01,
      ),
    );

    expect(dps.infDPS.IBSCBS).toEqual({
      finNFSe: FinalidadeNFSe.Regular,
      cIndOp: REAL_OPERATION_INDICATOR,
      indDest: IndicadorDestinatario.TomadorEhDestinatario,
      valores: {
        trib: { gIBSCBS: { CST: REAL_CST, cClassTrib: REAL_CLASS_CODE } },
      },
    });
    const validation = await validateDpsXml(buildDpsXml(dps), {
      throwOnInvalid: false,
    });
    expect(validation).toMatchObject({ valid: true });
  });

  it('omits the tomador when the invoice has no customer and it is not required', async () => {
    const allowed = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: { applicability: applicability({ customerRequired: false }) },
          invoice: { customer: null },
        }),
        RTC_V1_01,
      ),
    );
    expect(allowed.infDPS.toma).toBeUndefined();

    const required = errorFrom(
      await new DpsBuilder().build(
        input({ invoice: { customer: null } }),
        RTC_V1_01,
      ),
    );
    expect(required.code).toBe('DPS_SCHEMA_VALIDATION_FAILED');
    expect(required.details).toMatchObject({ reason: 'tomador_required' });
  });

  it('adds vDescCondIncond when the invoice carries an unconditional discount', async () => {
    const base = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    const discounted = dpsFrom(
      await new DpsBuilder().build(
        input({ invoice: { discountAmount: '50.00' } }),
        RTC_V1_01,
      ),
    );

    expect(discounted.infDPS.valores.vDescCondIncond).toEqual({
      vDescIncond: 50,
    });
    expect(discounted.infDPS).toEqual({
      ...base.infDPS,
      valores: {
        ...base.infDPS.valores,
        vDescCondIncond: { vDescIncond: 50 },
      },
    });
  });

  it('maps ISS withholding to RetidoPeloTomador only when required', async () => {
    const retained = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: { applicability: applicability({ issWithheld: REQUIRED }) },
        }),
        RTC_V1_01,
      ),
    );
    expect(retained.infDPS.valores.trib.tribMun.tpRetISSQN).toBe(
      TipoRetISSQN.RetidoPeloTomador,
    );

    const notRetained = dpsFrom(
      await new DpsBuilder().build(input(), RTC_V1_01),
    );
    expect(notRetained.infDPS.valores.trib.tribMun.tpRetISSQN).toBe(
      TipoRetISSQN.NaoRetido,
    );
    expect(notRetained.infDPS.valores.trib.tribMun.tribISSQN).toBe(
      TipoTribISSQN.OperacaoTributavel,
    );
  });

  it('rejects unknown or non-production layouts with DPS_LAYOUT_UNSUPPORTED', async () => {
    const unknown = errorFrom(
      await new DpsBuilder().build(input(), 'rtc-v1.04'),
    );
    expect(unknown.code).toBe('DPS_LAYOUT_UNSUPPORTED');
    expect(unknown.details).toMatchObject({ layout: 'rtc-v1.04' });

    const publishedOnly = errorFrom(
      await new DpsBuilder({
        [RTC_V1_01]: { id: RTC_V1_01, status: 'published' },
      }).build(input(), RTC_V1_01),
    );
    expect(publishedOnly.code).toBe('DPS_LAYOUT_UNSUPPORTED');
    expect(publishedOnly.details).toMatchObject({
      layout: RTC_V1_01,
      status: 'published',
    });
  });

  it('accepts alphanumeric CNPJ for provider and customer and passes XSD validation', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: {
            taxes: {},
            classification: classification({
              nbsCode: REAL_NBS,
              cst: REAL_CST,
              classCode: REAL_CLASS_CODE,
              operationIndicator: REAL_OPERATION_INDICATOR,
            }),
          },
          emitente: { cnpj: '12A34B56C7D882' },
          invoice: {
            customer: {
              kind: 'CNPJ',
              taxId: 'ABC12345DE6777',
              name: 'Cliente Alfanumerico LTDA',
            },
          },
        }),
        RTC_V1_01,
      ),
    );

    expect(dps.infDPS.prest.identificador).toEqual({
      CNPJ: '12A34B56C7D882',
    });
    expect(dps.infDPS.toma?.identificador).toEqual({
      CNPJ: 'ABC12345DE6777',
    });
    const validation = await validateDpsXml(buildDpsXml(dps), {
      throwOnInvalid: false,
    });
    expect(validation).toMatchObject({ valid: true });
  });

  it('does not include the IBSCBS group when neither CBS nor IBS is required', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: {
            applicability: applicability({
              cbs: na('IBS/CBS not applicable in this fiscal phase'),
              ibs: na('IBS/CBS not applicable in this fiscal phase'),
            }),
          },
        }),
        RTC_V1_01,
      ),
    );
    expect(dps.infDPS.IBSCBS).toBeUndefined();
  });

  it('produces a deterministic DPS for identical inputs', async () => {
    const first = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    const second = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    expect(first).toEqual(second);
  });

  it('fails with DPS_SCHEMA_VALIDATION_FAILED when IBS/CBS is required but the classification is incomplete', async () => {
    const error = errorFrom(
      await new DpsBuilder().build(
        input({
          result: {
            classification: classification({
              nbsCode: null,
              cst: null,
              classCode: null,
              operationIndicator: null,
            }),
          },
        }),
        RTC_V1_01,
      ),
    );
    expect(error.code).toBe('DPS_SCHEMA_VALIDATION_FAILED');
    expect(error.details).toMatchObject({
      reason: 'classification_incomplete_for_ibscbs',
      missingFields: ['nbsCode', 'cst', 'classCode', 'operationIndicator'],
    });
  });
});
