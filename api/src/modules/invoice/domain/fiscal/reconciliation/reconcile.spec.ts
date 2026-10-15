import type {
  NFSe,
  RtcIbsCbs,
  RtcTotalIbs,
  ValoresNFSe,
} from 'open-nfse';
import type { CalculatedTaxes } from '../fiscal-calculation-result';
import type { FiscalCalculationResult } from '../fiscal-calculation-result';
import { Decimal } from '../money';
import { reconcile } from './reconcile';

const resultOf = (
  taxes: CalculatedTaxes,
  taxableAmounts: Partial<
    Pick<FiscalCalculationResult['taxableAmounts'], 'ibsCbs' | 'gross'>
  > = {},
): FiscalCalculationResult => ({
  operationId: 'a1a1a1a1-1111-4111-8111-111111111111',
  companyId: 'b2b2b2b2-2222-4222-8222-222222222222',
  competenceDate: '2026-12-10',
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: 'c3c3c3c3-3333-4333-8333-333333333333',
  classification: {
    serviceCode: '010601',
    municipalServiceCode: null,
    nbsCode: null,
    cst: null,
    classCode: null,
    operationIndicator: null,
    source: 'company_service_profile',
    serviceProfileId: null,
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
    justification: 'company service profile',
  },
  taxableAmounts: {
    gross: taxableAmounts.gross ?? '1000.00',
    discount: '0.00',
    ibsCbs: taxableAmounts.ibsCbs,
  },
  taxes,
  withholdings: [],
  netReceivableAmount: '864.90',
  applicability: {
    strategy: 'regular',
    customerRequired: true,
    iss: { status: 'REQUIRED' },
    issWithheld: { status: 'NOT_APPLICABLE', reason: 'no withholding' },
    federalWithholding: { status: 'NOT_APPLICABLE', reason: 'none' },
    cbs: { status: 'REQUIRED' },
    ibs: { status: 'REQUIRED' },
    specialTreatment: { status: 'NOT_APPLICABLE', reason: 'none' },
    collectionWaived: true,
    rulesVersion: '2026.10-r1',
    legalReferences: ['LC 116/2003'],
  },
  collectionWaived: true,
  calculationSource: 'legacy+rtc',
  calculatorVersion: 'rtc-2026.1',
  catalogVersions: { nbs: '2026.1' },
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 116/2003'],
  warnings: [],
  requiresReview: false,
  trace: [{ step: 'RtcTaxCalculator', status: 'applied', durationMs: 2 }],
  calculationMemory: [],
});

/**
 * Builds the reconciled envelope. `reconcile` reads only the value fields
 * listed below, which all exist in open-nfse's domain.d.ts — the remaining
 * required groups of a real NFS-e are intentionally omitted.
 */
const nfseOf = (
  valores: Partial<ValoresNFSe> = {},
  ibscbs?: RtcIbsCbs,
): NFSe =>
  ({
    infNFSe: {
      valores: { vServ: 1000, vLiq: 864.9, ...valores },
      ...(ibscbs ? { IBSCBS: ibscbs } : {}),
    },
  }) as unknown as NFSe;

const ibsTotOf = (values: {
  vIBSTot: number;
  vIBSUF: number;
  vIBSMun: number;
}): RtcTotalIbs => ({
  vIBSTot: values.vIBSTot,
  gIBSUFTot: { vIBSUF: values.vIBSUF },
  gIBSMunTot: { vIBSMun: values.vIBSMun },
});

const ibscbsOf = (values: {
  vBC: number;
  vCBS: number;
  vIBSTot: number;
  vIBSUF: number;
  vIBSMun: number;
}): RtcIbsCbs => ({
  cLocalidadeIncid: '3550308',
  xLocalidadeIncid: 'SAO PAULO',
  valores: {
    vBC: values.vBC,
    uf: { pIBSUF: 0.1, pAliqEfetUF: 0.1 },
    mun: { pIBSMun: 0, pAliqEfetMun: 0 },
    fed: { pCBS: 0.9, pAliqEfetCBS: 0.9 },
  },
  totCIBS: {
    gCBS: { vCBS: values.vCBS },
    gIBS: ibsTotOf(values),
    vTotNF: values.vCBS + values.vIBSTot,
  },
});

const TOLERANCE = new Decimal('0.01');

describe('reconcile', () => {
  it('reports matched when every compared field is identical', () => {
    const local = resultOf(
      {
        iss: { base: '1000.00', rate: '3', amount: '30.00' },
        cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
        ibsState: { base: '1000.00', rate: '0.1', amount: '1.00' },
        ibsCity: { base: '1000.00', rate: '0', amount: '0.00' },
        ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
      },
      { ibsCbs: '1000.00' },
    );
    const authorized = nfseOf(
      { vISSQN: 30, vBC: 1000, vLiq: 864.9 },
      ibscbsOf({
        vBC: 1000,
        vCBS: 9,
        vIBSTot: 1,
        vIBSUF: 1,
        vIBSMun: 0,
      }),
    );

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('matched');
    expect(outcome.differences).toEqual([]);
    expect(outcome.localValues).toEqual({
      iss: '30.00',
      iss_base: '1000.00',
      cbs: '9.00',
      ibs_total: '1.00',
      ibs_state: '1.00',
      ibs_city: '0.00',
      ibs_cbs_base: '1000.00',
      net_value: '864.90',
    });
    expect(outcome.authorizedValues).toEqual({
      iss: '30',
      iss_base: '1000',
      cbs: '9',
      ibs_total: '1',
      ibs_state: '1',
      ibs_city: '0',
      ibs_cbs_base: '1000',
      net_value: '864.9',
    });
    expect(outcome.toleranceAbsolute).toBe('0.01');
  });

  it('reports within_tolerance when the difference is at the rounding limit', () => {
    const local = resultOf({
      iss: { base: '1000.00', rate: '3', amount: '30.00' },
    });
    const authorized = nfseOf({ vISSQN: 30.01, vBC: 1000 });

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('within_tolerance');
    expect(outcome.differences).toEqual([
      {
        field: 'iss',
        local: '30.00',
        authorized: '30.01',
        delta: '0.01',
        kind: 'amount',
      },
    ]);
  });

  it('reports divergent with the signed delta when the difference exceeds tolerance', () => {
    const local = resultOf({
      iss: { base: '1000.00', rate: '3', amount: '30.00' },
    });
    const authorized = nfseOf({ vISSQN: 31, vBC: 1000 });

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('divergent');
    expect(outcome.differences).toEqual([
      {
        field: 'iss',
        local: '30.00',
        authorized: '31',
        delta: '1.00',
        kind: 'amount',
      },
    ]);
  });

  it('reports missing_in_authorized when the local CBS exists without an IBSCBS group', () => {
    const local = resultOf({
      cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
    });
    const authorized = nfseOf({ vLiq: 864.9 });

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('divergent');
    expect(outcome.differences).toEqual([
      {
        field: 'cbs',
        local: '9.00',
        authorized: null,
        delta: null,
        kind: 'missing_in_authorized',
      },
    ]);
  });

  it('reports missing_locally when the authorized group exists without a local calculation', () => {
    const local = resultOf({});
    const authorized = nfseOf(
      {},
      ibscbsOf({ vBC: 1000, vCBS: 9, vIBSTot: 1, vIBSUF: 1, vIBSMun: 0 }),
    );

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('divergent');
    expect(outcome.differences).toEqual([
      expect.objectContaining({ field: 'cbs', kind: 'missing_locally' }),
      expect.objectContaining({ field: 'ibs_total', kind: 'missing_locally' }),
      expect.objectContaining({ field: 'ibs_state', kind: 'missing_locally' }),
      expect.objectContaining({ field: 'ibs_city', kind: 'missing_locally' }),
      expect.objectContaining({
        field: 'ibs_cbs_base',
        kind: 'missing_locally',
      }),
    ]);
  });

  it('takes the worst status across compared fields', () => {
    const local = resultOf(
      {
        iss: { base: '1000.00', rate: '3', amount: '30.00' },
        cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
        ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
        ibsState: { base: '1000.00', rate: '0.1', amount: '1.00' },
        ibsCity: { base: '1000.00', rate: '0', amount: '0.00' },
      },
      { ibsCbs: '1000.00' },
    );
    const authorized = nfseOf(
      { vISSQN: 30.01, vBC: 1000, vLiq: 864.9 },
      ibscbsOf({ vBC: 1000, vCBS: 9, vIBSTot: 1, vIBSUF: 2, vIBSMun: 0 }),
    );

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('divergent');
    expect(outcome.differences.map((d) => d.field)).toEqual([
      'iss',
      'ibs_state',
    ]);
  });

  it('compares binary-float SDK numbers through Decimal without false divergence', () => {
    const local = resultOf({
      iss: { base: '0.30', rate: '3', amount: '0.30' },
    });
    const authorized = nfseOf({ vISSQN: 0.1 + 0.2, vBC: 0.1 + 0.2 });

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('within_tolerance');
    expect(outcome.differences[0]).toEqual(
      expect.objectContaining({ field: 'iss', kind: 'amount' }),
    );
  });

  it('records vLiq as net_value without comparing it', () => {
    const local = resultOf({});
    const authorized = nfseOf({ vLiq: 100 });

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('matched');
    expect(outcome.differences).toEqual([]);
    expect(outcome.localValues.net_value).toBe('864.90');
    expect(outcome.authorizedValues.net_value).toBe('100');
  });

  it('reports matched for a MEI invoice without taxes on either side', () => {
    const local = resultOf({});
    const authorized = nfseOf();

    const outcome = reconcile(local, authorized, TOLERANCE);

    expect(outcome.status).toBe('matched');
    expect(outcome.differences).toEqual([]);
  });
});
