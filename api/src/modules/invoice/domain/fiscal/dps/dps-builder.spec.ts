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
          emitente: { specialTaxRegime: null },
        }),
        RTC_V1_01,
      ),
    );

    expect(dps.infDPS.prest.regTrib.opSimpNac).toBe(OpcaoSimplesNacional.MeEpp);
    expect(dps.infDPS.prest.regTrib.regApTribSN).toBe(
      RegimeApuracaoSimplesNacional.FederalEMunicipalPeloSN,
    );
    expect(dps.infDPS.prest.regTrib.regEspTrib).toBe(
      RegimeEspecialTributacao.Nenhum,
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

  describe('regEspTrib (E0174/E0175) and tribISSQN', () => {
    it('defaults a null special tax regime to "0"', async () => {
      const dps = dpsFrom(
        await new DpsBuilder().build(
          input({ emitente: { specialTaxRegime: null } }),
          RTC_V1_01,
        ),
      );
      expect(dps.infDPS.prest.regTrib.regEspTrib).toBe(
        RegimeEspecialTributacao.Nenhum,
      );
    });

    it('accepts a regular regime with regEspTrib="6" and serializes it as "6"', async () => {
      const dps = dpsFrom(
        await new DpsBuilder().build(
          input({ emitente: { specialTaxRegime: '6' } }),
          RTC_V1_01,
        ),
      );
      expect(dps.infDPS.prest.regTrib.regEspTrib).toBe(
        RegimeEspecialTributacao.SociedadeProfissionais,
      );
    });

    it('normalizes numeric legacy values such as "03" to "3"', async () => {
      const dps = dpsFrom(
        await new DpsBuilder().build(
          input({ emitente: { specialTaxRegime: ' 03 ' } }),
          RTC_V1_01,
        ),
      );
      expect(dps.infDPS.prest.regTrib.regEspTrib).toBe(
        RegimeEspecialTributacao.MicroempresaMunicipal,
      );
    });

    it('rejects free text that predates this validation with FISCAL_VALIDATION_FAILED', async () => {
      const error = errorFrom(
        await new DpsBuilder().build(
          input({ emitente: { specialTaxRegime: 'Sociedade Simples' } }),
          RTC_V1_01,
        ),
      );
      expect(error.code).toBe('FISCAL_VALIDATION_FAILED');
      expect(error.details).toMatchObject({
        reason: 'special_tax_regime_invalid',
      });
    });

    it('rejects MEI with a non-zero regEspTrib citing E0174', async () => {
      const error = errorFrom(
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
            emitente: { specialTaxRegime: '3' },
          }),
          RTC_V1_01,
        ),
      );
      expect(error.code).toBe('FISCAL_VALIDATION_FAILED');
      expect(error.details).toMatchObject({
        reason: 'special_tax_regime_incompatible_with_simples',
        rule: 'E0174',
      });
    });

    it('rejects Simples Nacional with a non-zero regEspTrib citing E0175', async () => {
      const error = errorFrom(
        await new DpsBuilder().build(
          input({
            result: { taxRegime: 'SIMPLES_NACIONAL', taxes: {} },
            emitente: { specialTaxRegime: '6' },
          }),
          RTC_V1_01,
        ),
      );
      expect(error.code).toBe('FISCAL_VALIDATION_FAILED');
      expect(error.details).toMatchObject({
        reason: 'special_tax_regime_incompatible_with_simples',
        rule: 'E0175',
      });
    });

    it('keeps tribISSQN as OperacaoTributavel for the supported (REQUIRED/NOT_APPLICABLE) ISS cases', async () => {
      const required = dpsFrom(
        await new DpsBuilder().build(input(), RTC_V1_01),
      );
      expect(required.infDPS.valores.trib.tribMun.tribISSQN).toBe(
        TipoTribISSQN.OperacaoTributavel,
      );

      const notApplicable = dpsFrom(
        await new DpsBuilder().build(
          input({
            result: {
              applicability: applicability({
                iss: na('ISS recolhido no DAS'),
              }),
            },
          }),
          RTC_V1_01,
        ),
      );
      expect(notApplicable.infDPS.valores.trib.tribMun.tribISSQN).toBe(
        TipoTribISSQN.OperacaoTributavel,
      );
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

  it('adds vDedRed/vDR when the invoice carries a declared deduction', async () => {
    const base = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    const deducted = dpsFrom(
      await new DpsBuilder().build(
        input({ invoice: { deductionAmount: '400.00' } }),
        RTC_V1_01,
      ),
    );

    expect(deducted.infDPS.valores.vDedRed).toEqual({ vDR: 400 });
    expect(deducted.infDPS).toEqual({
      ...base.infDPS,
      valores: { ...base.infDPS.valores, vDedRed: { vDR: 400 } },
    });
  });

  it('serializes the deduction in the XML and keeps it schema valid', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({ invoice: { deductionAmount: '400.00' } }),
        RTC_V1_01,
      ),
    );
    const xml = buildDpsXml(dps);
    expect(xml).toContain('<vDedRed><vDR>400</vDR></vDedRed>');
    const validation = await validateDpsXml(xml, { throwOnInvalid: false });
    expect(validation.valid).toBe(true);
  });

  it('omits vDedRed when the deduction is zero or absent', async () => {
    const zero = dpsFrom(
      await new DpsBuilder().build(
        input({ invoice: { deductionAmount: '0.00' } }),
        RTC_V1_01,
      ),
    );
    const absent = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    expect(zero.infDPS.valores.vDedRed).toBeUndefined();
    expect(absent.infDPS.valores.vDedRed).toBeUndefined();
  });

  it('adds serv/infoCompl with the purchase order and the notes, changing nothing else', async () => {
    const base = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    const withInfo = dpsFrom(
      await new DpsBuilder().build(
        input({
          invoice: { purchaseOrder: 'PO-4521', notes: 'Parcela 2 de 3' },
        }),
        RTC_V1_01,
      ),
    );

    expect(withInfo.infDPS.serv.infoCompl).toEqual({
      xPed: 'PO-4521',
      xInfComp: 'Parcela 2 de 3',
    });
    expect(withInfo.infDPS).toEqual({
      ...base.infDPS,
      serv: {
        ...base.infDPS.serv,
        infoCompl: { xPed: 'PO-4521', xInfComp: 'Parcela 2 de 3' },
      },
    });
  });

  it('serializes infoCompl in the XML and keeps it schema valid', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          invoice: { purchaseOrder: 'PO-4521', notes: 'Parcela 2 de 3' },
        }),
        RTC_V1_01,
      ),
    );
    const xml = buildDpsXml(dps);
    expect(xml).toContain('<xPed>PO-4521</xPed>');
    expect(xml).toContain('<xInfComp>Parcela 2 de 3</xInfComp>');
    const validation = await validateDpsXml(xml, { throwOnInvalid: false });
    expect(validation.valid).toBe(true);
  });

  it('sends only the field that was informed and omits infoCompl when there is none', async () => {
    const onlyOrder = dpsFrom(
      await new DpsBuilder().build(
        input({ invoice: { purchaseOrder: 'PO-1' } }),
        RTC_V1_01,
      ),
    );
    const none = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    expect(onlyOrder.infDPS.serv.infoCompl).toEqual({ xPed: 'PO-1' });
    expect(none.infDPS.serv.infoCompl).toBeUndefined();
  });

  const abroad = {
    country: 'US',
    postalCode: '94105',
    city: 'San Francisco',
    region: 'CA',
    street: '1 Market St',
    number: '100',
    district: 'SoMa',
  };

  it('identifies a customer abroad by NIF with the address abroad, schema valid', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          invoice: {
            customer: {
              kind: 'FOREIGN',
              name: 'Acme Inc.',
              email: 'ap@acme.test',
              foreign: {
                ...abroad,
                taxId: '12-3456789',
                complement: 'Suite 4',
              },
            },
          },
        }),
        RTC_V1_01,
      ),
    );
    expect(dps.infDPS.toma).toEqual({
      identificador: { NIF: '12-3456789' },
      xNome: 'Acme Inc.',
      end: {
        localidade: {
          endExt: {
            cPais: 'US',
            cEndPost: '94105',
            xCidade: 'San Francisco',
            xEstProvReg: 'CA',
          },
        },
        xLgr: '1 Market St',
        nro: '100',
        xCpl: 'Suite 4',
        xBairro: 'SoMa',
      },
      email: 'ap@acme.test',
    });
    const xml = buildDpsXml(dps);
    expect(xml).toContain('<NIF>12-3456789</NIF>');
    expect(xml).toContain('<cPais>US</cPais>');
    const validation = await validateDpsXml(xml, { throwOnInvalid: false });
    expect(validation.valid).toBe(true);
  });

  it('uses cNaoNIF when the customer abroad has no tax id, schema valid', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          invoice: {
            customer: {
              kind: 'FOREIGN',
              name: 'Acme Inc.',
              foreign: { ...abroad, noTaxIdReason: 'exempt' },
            },
          },
        }),
        RTC_V1_01,
      ),
    );
    expect(dps.infDPS.toma?.identificador).toEqual({ cNaoNIF: '1' });
    const validation = await validateDpsXml(buildDpsXml(dps), {
      throwOnInvalid: false,
    });
    expect(validation.valid).toBe(true);
  });

  it('keeps the tax treatment of the invoice: a customer abroad is not an export by itself', async () => {
    const base = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          invoice: {
            customer: {
              kind: 'FOREIGN',
              name: 'Acme Inc.',
              foreign: { ...abroad, taxId: '12-3456789' },
            },
          },
        }),
        RTC_V1_01,
      ),
    );
    expect(dps.infDPS.valores).toEqual(base.infDPS.valores);
    expect(dps.infDPS.serv).toEqual(base.infDPS.serv);
  });

  const ORIGINAL_KEY = '43144000000000000000000000000000000000000000000000';

  it('adds the subst group that makes the DPS a substitute, schema valid', async () => {
    const base = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          invoice: {
            substitution: {
              accessKey: ORIGINAL_KEY,
              description: 'Descrição do serviço corrigida',
            },
          },
        }),
        RTC_V1_01,
      ),
    );
    expect(dps.infDPS.subst).toEqual({
      chSubstda: ORIGINAL_KEY,
      cMotivo: '99',
      xMotivo: 'Descrição do serviço corrigida',
    });
    // Nothing else changes: the customer, the competence and the amount stay as issued (E0061).
    expect(dps.infDPS).toEqual({ ...base.infDPS, subst: dps.infDPS.subst });
    const xml = buildDpsXml(dps);
    expect(xml).toContain(`<chSubstda>${ORIGINAL_KEY}</chSubstda>`);
    const validation = await validateDpsXml(xml, { throwOnInvalid: false });
    expect(validation.valid).toBe(true);
  });

  it('has no subst group on an ordinary invoice', async () => {
    const dps = dpsFrom(await new DpsBuilder().build(input(), RTC_V1_01));
    expect(dps.infDPS.subst).toBeUndefined();
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

  it('builds and validates the DPS against the NT 009 release 1 XSD with layout nt009-r1', async () => {
    const invoice = { ...input().invoice, deductionAmount: '10.00' };
    const dps = dpsFrom(
      await new DpsBuilder().build(input({ invoice }), 'nt009-r1'),
    );
    const xml = buildDpsXml(dps, { layout: 'nt009-r1' });
    expect(xml).toContain('<vAjusteBC><vAjusteBCISSQN>10</vAjusteBCISSQN>');
    expect(xml).toMatch(/<tpEmit>1<\/tpEmit><finNFSe>0<\/finNFSe>/);
  });

  it('builds a Simples Nacional DPS without tomador and without IBS/CBS in both layouts', async () => {
    const simples = input({
      result: {
        taxRegime: 'SIMPLES_NACIONAL',
        applicability: applicability({
          strategy: 'simples',
          customerRequired: false,
          cbs: na('Simples sem opção pelo regime regular'),
          ibs: na('Simples sem opção pelo regime regular'),
        }),
      },
      invoice: { customer: null },
      emitente: { simplesTotTrib: { regApTribSN: 1, totalRate: '6.54' } },
    });
    for (const layout of ['rtc-v1.01', 'nt009-r1'] as const) {
      const dps = dpsFrom(await new DpsBuilder().build(simples, layout));
      const xml = buildDpsXml(dps, {
        layout: layout === 'nt009-r1' ? 'nt009-r1' : 'v1.01',
      });
      expect(xml).not.toContain('<IBSCBS>');
      if (layout === 'nt009-r1') expect(xml).toContain('<finNFSe>0</finNFSe>');
    }
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

describe('DpsBuilder — NT 009 release 1 (XSD 20261020, Produção Restrita)', () => {
  const NT009 = 'nt009-r1';
  const ibscbsClassification = (serviceCode = '010601') =>
    classification({
      serviceCode,
      nbsCode: REAL_NBS,
      cst: REAL_CST,
      classCode: REAL_CLASS_CODE,
      operationIndicator: REAL_OPERATION_INDICATOR,
    });
  const restricted = {
    environment: 'live' as const,
    sefin: 'restricted' as const,
  };

  const validNt009Xml = async (dps: DPS): Promise<string> => {
    const xml = buildDpsXml(dps, { layout: NT009 });
    const validation = await validateDpsXml(xml, {
      throwOnInvalid: false,
      layout: NT009,
    });
    expect(validation.violations).toEqual([]);
    expect(validation.valid).toBe(true);
    return xml;
  };

  it('puts CST and cClassTrib directly under IBSCBS/valores/trib and validates against the XSD', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: { classification: ibscbsClassification() },
          invoice: restricted,
        }),
        NT009,
      ),
    );
    const xml = await validNt009Xml(dps);
    expect(xml).toContain(
      `<trib><CST>${REAL_CST}</CST><cClassTrib>${REAL_CLASS_CODE}</cClassTrib></trib>`,
    );
    expect(xml).not.toContain('<gIBSCBS>');
    expect(xml).toMatch(/<tpEmit>1<\/tpEmit><finNFSe>0<\/finNFSe>/);
  });

  it('sends the issuer deduction as the vAjusteBC group and validates against the XSD', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: { classification: ibscbsClassification() },
          invoice: { ...restricted, deductionAmount: '25.50' },
        }),
        NT009,
      ),
    );
    const xml = await validNt009Xml(dps);
    expect(xml).toContain(
      '<vAjusteBC><vAjusteBCISSQN>25.50</vAjusteBCISSQN></vAjusteBC>',
    );
    expect(xml).not.toContain('<vDedRed>');
  });

  it('keeps the current layout output unchanged (vDedRed and gIBSCBS)', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: { classification: ibscbsClassification() },
          invoice: { deductionAmount: '25.50' },
        }),
        RTC_V1_01,
      ),
    );
    const xml = buildDpsXml(dps, { layout: 'v1.01' });
    expect(xml).toContain('<vDedRed>');
    expect(xml).toContain('<gIBSCBS>');
    expect(xml).not.toContain('<vAjusteBC>');
  });

  it.each([
    '990201',
    '990301',
    '990302',
    '990303',
    '990304',
    '990305',
    '990401',
  ])(
    'emits the IBS/CBS-only event %s with tribISSQN=4 and validates against the XSD',
    async (serviceCode) => {
      const dps = dpsFrom(
        await new DpsBuilder().build(
          input({
            result: {
              classification: ibscbsClassification(serviceCode),
              applicability: applicability({
                iss: na('NT 009 item 99: no ISSQN incidence'),
              }),
            },
            invoice: restricted,
          }),
          NT009,
        ),
      );
      expect(dps.infDPS.serv.cServ.cTribNac).toBe(serviceCode);
      expect(dps.infDPS.valores.trib.tribMun.tribISSQN).toBe(
        TipoTribISSQN.NaoIncidencia,
      );
      expect(dps.infDPS.valores.trib.tribMun.tpRetISSQN).toBe(
        TipoRetISSQN.NaoRetido,
      );
      const xml = await validNt009Xml(dps);
      expect(xml).not.toContain('<pAliq>');
      expect(xml).toContain('<IBSCBS>');
    },
  );

  it('refuses the NT 009 events on the current layout', async () => {
    const error = errorFrom(
      await new DpsBuilder().build(
        input({ result: { classification: ibscbsClassification('990401') } }),
        RTC_V1_01,
      ),
    );
    expect(error.code).toBe('DPS_LAYOUT_UNSUPPORTED');
    expect(error.details).toMatchObject({ reason: 'layout_without_event' });
  });

  it('refuses ISS withholding or ISS base adjustment on the NT 009 events', async () => {
    const withheld = errorFrom(
      await new DpsBuilder().build(
        input({
          result: {
            classification: ibscbsClassification('990301'),
            applicability: applicability({ issWithheld: REQUIRED }),
          },
          invoice: restricted,
        }),
        NT009,
      ),
    );
    expect(withheld.details).toMatchObject({
      reason: 'iss_withholding_not_allowed',
    });

    const adjusted = errorFrom(
      await new DpsBuilder().build(
        input({
          result: { classification: ibscbsClassification('990301') },
          invoice: { ...restricted, deductionAmount: '10.00' },
        }),
        NT009,
      ),
    );
    expect(adjusted.details).toMatchObject({
      reason: 'iss_base_adjustment_not_allowed',
    });
  });

  it('never builds the NT 009 layout for a live invoice bound for production', async () => {
    for (const sefin of [undefined, 'production' as const]) {
      const error = errorFrom(
        await new DpsBuilder().build(
          input({
            result: { classification: ibscbsClassification() },
            invoice: { environment: 'live', sefin },
          }),
          NT009,
        ),
      );
      expect(error.code).toBe('DPS_LAYOUT_UNSUPPORTED');
      expect(error.details).toMatchObject({
        reason: 'restricted_environment_only',
      });
    }
  });

  it('the NT 009 XML does not validate against the current production XSD', async () => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          result: { classification: ibscbsClassification() },
          invoice: restricted,
        }),
        NT009,
      ),
    );
    const legacy = await validateDpsXml(buildDpsXml(dps, { layout: NT009 }), {
      throwOnInvalid: false,
      layout: 'v1.01',
    });
    expect(legacy.valid).toBe(false);
  });
});

describe('DpsBuilder auto layout per emission', () => {
  it.each([
    ['production', '2026-11-30T23:59:59-03:00', 'v1.01'],
    ['production', '2026-12-01T00:00:00-03:00', 'nt009-r1'],
    ['restricted', '2026-11-30T23:59:59-03:00', 'nt009-r1'],
  ] as const)('%s at %s validates as %s', async (sefin, issuedAt, layout) => {
    const dps = dpsFrom(
      await new DpsBuilder().build(
        input({
          emitente: { cnpj: '12A34B56C7D882' },
          invoice: {
            environment: 'live',
            sefin,
            issuedAt,
            competenceDate: issuedAt.slice(0, 10),
            customer: null,
          },
          result: {
            classification: classification({
              nbsCode: REAL_NBS,
              cst: REAL_CST,
              classCode: REAL_CLASS_CODE,
              operationIndicator: REAL_OPERATION_INDICATOR,
            }),
            applicability: applicability({ customerRequired: false }),
          },
        }),
        'auto',
      ),
    );
    expect(dps.infDPS.tpAmb).toBe(
      sefin === 'production'
        ? TipoAmbienteDps.Producao
        : TipoAmbienteDps.Homologacao,
    );
    const xml = buildDpsXml(dps, { layout });
    expect(xml.includes('<gIBSCBS>')).toBe(layout === 'v1.01');
    expect(
      (await validateDpsXml(xml, { layout, throwOnInvalid: false })).valid,
    ).toBe(true);
  });
});
