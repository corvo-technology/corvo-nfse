import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { TaxApplicability } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { FiscalCalculationResult } from '@/modules/invoice/domain/fiscal/fiscal-calculation-result';
import type {
  IFiscalSnapshotRepository,
  NewFiscalSnapshot,
} from '@/modules/invoice/domain/fiscal/fiscal-snapshot.repository';
import { FiscalSnapshotService } from './fiscal-snapshot.service';

const classification = (
  overrides: Partial<ServiceTaxClassification> = {},
): ServiceTaxClassification => ({
  serviceCode: '010601',
  municipalServiceCode: null,
  nbsCode: null,
  cst: null,
  classCode: null,
  operationIndicator: null,
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
  justification: 'company service profile',
  ...overrides,
});

const applicability = (
  overrides: Partial<TaxApplicability> = {},
): TaxApplicability => ({
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
  ...overrides,
});

const result = (
  overrides: Partial<FiscalCalculationResult> = {},
): FiscalCalculationResult => ({
  operationId: 'inv-1',
  companyId: 'comp-1',
  competenceDate: '2026-12-10',
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: 'cfp-1',
  classification: classification(),
  taxableAmounts: { gross: '1000.00', discount: '100.00', iss: '900.00' },
  taxes: {
    iss: { base: '900.00', rate: '3', amount: '27.00' },
    cbs: { base: '900.00', rate: '0.9', amount: '8.10' },
    ibsTotal: { base: '900.00', rate: '0.1', amount: '0.90' },
  },
  withholdings: [],
  netReceivableAmount: '864.90',
  applicability: applicability(),
  collectionWaived: true,
  calculationSource: 'legacy+rtc',
  calculatorVersion: 'rtc-2026.1',
  catalogVersions: { nbs: '2026.1' },
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 116/2003'],
  warnings: [],
  requiresReview: false,
  trace: [
    { step: 'LegacyTaxCalculator', status: 'applied', durationMs: 1 },
    { step: 'RtcTaxCalculator', status: 'applied', durationMs: 2 },
  ],
  calculationMemory: [],
  ...overrides,
});

const fakeRepository = () => {
  const inserted: NewFiscalSnapshot[] = [];
  const repository: IFiscalSnapshotRepository = {
    insert: jest.fn(async (snapshot: NewFiscalSnapshot) => {
      inserted.push(snapshot);
      return 'snap-1';
    }),
    findByInvoiceId: jest.fn(async () => null),
  };
  return { repository, inserted };
};

describe('FiscalSnapshotService', () => {
  it('maps the calculation result to the snapshot row and persists it', async () => {
    const { repository, inserted } = fakeRepository();
    const service = new FiscalSnapshotService(repository);
    const calculatedAt = new Date('2026-12-10T12:00:00Z');

    const id = await service.persist({
      invoiceId: 'inv-1',
      tenantId: 'ten-1',
      result: result(),
      specialTaxRegime: 'ME_EPP',
      attempt: 1,
      trace: result().trace,
      calculatedAt,
    });

    expect(id).toBe('snap-1');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      invoiceId: 'inv-1',
      tenantId: 'ten-1',
      companyId: 'comp-1',
      taxRegime: 'LUCRO_PRESUMIDO',
      profileId: 'cfp-1',
      serviceProfileId: 'sp-1',
      specialTaxRegime: 'ME_EPP',
      attempt: 1,
      calculationVersion: '2026.10-r1',
      grossAmount: '1000.00',
      discountAmount: '100.00',
      issAmount: '27.00',
      cbsAmount: '8.10',
      ibsTotalAmount: '0.90',
      netReceivableAmount: '864.90',
      calculatedAt,
    });
    expect(inserted[0].result).toEqual(result());
  });

  it('keeps money as exact decimal strings and leaves absent taxes null', async () => {
    const { repository, inserted } = fakeRepository();
    const service = new FiscalSnapshotService(repository);

    await service.persist({
      invoiceId: 'inv-2',
      tenantId: 'ten-1',
      result: result({
        taxableAmounts: { gross: '50.00', discount: '0.00' },
        taxes: {},
        netReceivableAmount: '50.00',
        calculationSource: 'none',
      }),
      specialTaxRegime: null,
      attempt: 1,
      trace: result().trace,
    });

    const snapshot = inserted[0];
    expect(snapshot.grossAmount).toBe('50.00');
    expect(snapshot.netReceivableAmount).toBe('50.00');
    expect(snapshot.issAmount).toBeNull();
    expect(snapshot.cbsAmount).toBeNull();
    expect(snapshot.ibsTotalAmount).toBeNull();
    expect(snapshot.specialTaxRegime).toBeNull();
    expect(snapshot.calculatedAt).toBeInstanceOf(Date);
  });

  it('preserves the service profile of a classification without a profile', async () => {
    const { repository, inserted } = fakeRepository();
    const service = new FiscalSnapshotService(repository);

    await service.persist({
      invoiceId: 'inv-3',
      tenantId: 'ten-1',
      result: result({
        classification: classification({ serviceProfileId: null }),
      }),
      specialTaxRegime: null,
      attempt: 2,
      trace: result().trace,
    });

    expect(inserted[0].serviceProfileId).toBeNull();
    expect(inserted[0].attempt).toBe(2);
  });

  it('delegates lookup to the repository', async () => {
    const { repository } = fakeRepository();
    const service = new FiscalSnapshotService(repository);

    expect(await service.findByInvoiceId('inv-1', 'ten-1')).toBeNull();
    expect(repository.findByInvoiceId).toHaveBeenCalledWith('inv-1', 'ten-1');
  });
});
