import { OpcaoSimplesNacional, TipoRetISSQN, type DPS } from 'open-nfse';
import type { TaxApplicability } from '../applicability/tax-applicability';
import type { ServiceTaxClassification } from '../classification/service-tax-classification';
import type { FiscalCalculationResult } from '../fiscal-calculation-result';
import { DpsBuilder, type DpsBuildInput } from './dps-builder';
import { DEDUCTION_ALLOWED_CTRIBNAC } from './anexo1-rules';

/**
 * Conformidade do DPS com as regras de rejeição do Anexo I (SEFIN/ADN – DPS
 * NFS-e v1.01, 09/02/2026) que o `DpsBuilder` controla sozinho. As regras que
 * dependem de decisão anterior à montagem do DPS (E0436, E0441/E0442 dedução;
 * E0583 retenção do MEI) são provadas onde a decisão acontece:
 * `deduction-policy.spec.ts` e `tax-strategy.spec.ts`.
 */
const na = (reason: string) => ({ status: 'NOT_APPLICABLE' as const, reason });

const classification: ServiceTaxClassification = {
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
    incidenceMunicipalityCode: '3550308',
  },
  withholding: { policy: 'NONE_CONFIRMED', rates: {} },
  catalogVersions: { nbs: '2026.1' },
  catalogValidated: true,
  justification: 'conformance fixture',
};

const applicability = (strategy: string): TaxApplicability => ({
  strategy,
  customerRequired: false,
  iss: na('ISS recolhido no DAS'),
  issWithheld: na('no ISS withholding'),
  federalWithholding: na('no federal withholding'),
  cbs: na('fase de teste de 2026'),
  ibs: na('fase de teste de 2026'),
  specialTreatment: na('no special treatment'),
  collectionWaived: false,
  rulesVersion: '2026.10-r1',
  legalReferences: [],
});

const result = (
  taxRegime: 'MEI' | 'SIMPLES_NACIONAL',
): FiscalCalculationResult => ({
  operationId: 'inv-1',
  companyId: 'comp-1',
  competenceDate: '2026-12-10',
  taxRegime,
  profileId: 'cfp-1',
  classification,
  taxableAmounts: { gross: '1000.00', discount: '0.00' },
  taxes: {},
  withholdings: [],
  netReceivableAmount: '1000.00',
  applicability: applicability(
    taxRegime === 'MEI' ? 'mei' : 'simples-nacional',
  ),
  collectionWaived: false,
  calculationSource: 'none',
  calculatorVersion: null,
  catalogVersions: { nbs: '2026.1' },
  rulesVersion: '2026.10-r1',
  legalReferences: [],
  warnings: [],
  requiresReview: false,
  trace: [],
  calculationMemory: [],
});

const input = (taxRegime: 'MEI' | 'SIMPLES_NACIONAL'): DpsBuildInput => ({
  result: result(taxRegime),
  invoice: {
    number: '1',
    serie: '1',
    issuedAt: '2026-12-10T12:00:00.000Z',
    competenceDate: '2026-12-10',
    description: 'Consultoria em TI',
    municipalityCode: '3550308',
    environment: 'test',
    customer: { kind: 'CNPJ', taxId: '12345678000195', name: 'Cliente' },
    discountAmount: '0.00',
  },
  emitente: {
    cnpj: '11222333000181',
    municipalReg: null,
    municipalityCode: '3550308',
    specialTaxRegime: null,
    simplesIssRate: null,
  },
});

const build = async (taxRegime: 'MEI' | 'SIMPLES_NACIONAL'): Promise<DPS> => {
  const built = await new DpsBuilder().build(input(taxRegime), 'rtc-v1.01');
  if (!built.ok) throw new Error(built.error.message);
  return built.value;
};

describe.each(['MEI', 'SIMPLES_NACIONAL'] as const)(
  'Anexo I conformance (%s)',
  (regime) => {
    const mei = regime === 'MEI';

    it('E0174/E0175: regEspTrib is Nenhum', async () => {
      const dps = await build(regime);
      expect(String(dps.infDPS.prest.regTrib.regEspTrib)).toBe('0');
    });

    it(`${mei ? 'E0162: MEI never sends' : 'E0166: ME/EPP always sends'} regApTribSN`, async () => {
      const dps = await build(regime);
      expect(dps.infDPS.prest.regTrib.opSimpNac).toBe(
        mei ? OpcaoSimplesNacional.Mei : OpcaoSimplesNacional.MeEpp,
      );
      if (mei) expect(dps.infDPS.prest.regTrib.regApTribSN).toBeUndefined();
      else expect(dps.infDPS.prest.regTrib.regApTribSN).toBeDefined();
    });

    it('E0583: ISS is not withheld when no withholding applies', async () => {
      const dps = await build(regime);
      expect(dps.infDPS.valores.trib.tribMun.tpRetISSQN).toBe(
        TipoRetISSQN.NaoRetido,
      );
    });

    it('E0712: never sends indTotTrib for ME/EPP', async () => {
      const dps = await build(regime);
      if (!mei)
        expect(dps.infDPS.valores.trib.totTrib).not.toHaveProperty(
          'indTotTrib',
        );
    });

    it('E0710: never sends pTotTribSN for MEI', async () => {
      const dps = await build(regime);
      if (mei)
        expect(dps.infDPS.valores.trib.totTrib).not.toHaveProperty(
          'pTotTribSN',
        );
    });

    it('E0600 and E0534: MEI never sends aliquota or municipal benefit', async () => {
      const dps = await build(regime);
      if (mei) {
        const serialized = JSON.stringify(dps.infDPS.valores.trib);
        expect(serialized).not.toContain('pAliq');
        expect(serialized).not.toMatch(/"(BM|nBM)"/);
      }
    });
  },
);

describe('Anexo I deduction list', () => {
  it('has the 49 cTribNac of rules E0441/E0442', () => {
    expect(DEDUCTION_ALLOWED_CTRIBNAC.size).toBe(49);
    expect(DEDUCTION_ALLOWED_CTRIBNAC.has('060101')).toBe(true);
    expect(DEDUCTION_ALLOWED_CTRIBNAC.has('010101')).toBe(false);
  });
});

describe('Anexo I totTrib and regApTribSN with simplesTotTrib', () => {
  const buildWith = async (
    taxRegime: 'MEI' | 'SIMPLES_NACIONAL',
    simplesTotTrib: {
      regApTribSN: 1 | 2 | 3 | null;
      totalRate: string | null;
    },
  ) => {
    const base = input(taxRegime);
    return new DpsBuilder().build(
      { ...base, emitente: { ...base.emitente, simplesTotTrib } },
      'rtc-v1.01',
    );
  };

  it('MEI: indTotTrib 0, no pTotTribSN (E0710) and no regApTribSN (E0162)', async () => {
    const built = await buildWith('MEI', {
      regApTribSN: null,
      totalRate: null,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { totTrib } = built.value.infDPS.valores.trib;
    expect(totTrib).toEqual({ indTotTrib: '0' });
    expect(built.value.infDPS.prest.regTrib.regApTribSN).toBeUndefined();
  });

  it('ME/EPP: pTotTribSN from the informed rate, never indTotTrib (E0712)', async () => {
    const built = await buildWith('SIMPLES_NACIONAL', {
      regApTribSN: 1,
      totalRate: '6.54',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { totTrib } = built.value.infDPS.valores.trib;
    expect(totTrib).toEqual({ pTotTribSN: 6.54 });
    expect(totTrib).not.toHaveProperty('indTotTrib');
    expect(String(built.value.infDPS.prest.regTrib.regApTribSN)).toBe('1');
  });

  it('ME/EPP: regApTribSN follows the profile (E0166)', async () => {
    const built = await buildWith('SIMPLES_NACIONAL', {
      regApTribSN: 2,
      totalRate: '6.54',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(String(built.value.infDPS.prest.regTrib.regApTribSN)).toBe('2');
  });

  it('ME/EPP without a rate fails instead of sending a zeroed number', async () => {
    const built = await buildWith('SIMPLES_NACIONAL', {
      regApTribSN: 1,
      totalRate: null,
    });
    expect(built.ok).toBe(false);
    expect(!built.ok && built.error.details).toMatchObject({
      reason: 'simples_total_rate_missing',
    });
  });
});
