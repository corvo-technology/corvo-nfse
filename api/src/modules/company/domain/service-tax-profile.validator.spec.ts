import { validateServiceTaxProfile } from './service-tax-profile.validator';
import type { NewServiceTaxProfile } from './service-tax-profile.repository';

const makeInput = (
  overrides: Partial<NewServiceTaxProfile> = {},
): NewServiceTaxProfile => ({
  name: 'Limpeza predial',
  serviceCode: '010101',
  municipalServiceCode: null,
  nbsCode: null,
  cst: null,
  classCode: null,
  operationIndicator: null,
  operationNature: 'SERVICE',
  regimeApplicability: [],
  incidenceMunicipalityCode: null,
  issTaxation: null,
  issRate: null,
  issWithholdingDefault: false,
  withholdingPolicy: 'UNKNOWN',
  withholdingRates: {},
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  classificationSource: 'manual',
  reviewStatus: 'unreviewed',
  catalogVersion: null,
  ...overrides,
});

describe('validateServiceTaxProfile', () => {
  it('accepts a minimal valid profile with no issues', () => {
    expect(validateServiceTaxProfile(makeInput())).toEqual([]);
  });

  it('accepts NORMAL ISS taxation without an issRate', () => {
    expect(
      validateServiceTaxProfile(
        makeInput({ issTaxation: 'NORMAL', issRate: null }),
      ),
    ).toEqual([]);
  });

  it('rejects a service code that is not six digits with an invalid issue', () => {
    const issues = validateServiceTaxProfile(
      makeInput({ serviceCode: '12345' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'serviceCode', code: 'invalid' }),
    );
  });

  it('rejects a blank name', () => {
    const issues = validateServiceTaxProfile(makeInput({ name: '   ' }));
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'name', code: 'blank' }),
    );
  });

  it('requires at least one rate when the withholding policy is CONFIGURED', () => {
    const issues = validateServiceTaxProfile(
      makeInput({ withholdingPolicy: 'CONFIGURED', withholdingRates: {} }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'withholdingRates', code: 'required' }),
    );
  });

  it('accepts CONFIGURED when at least one rate is present', () => {
    expect(
      validateServiceTaxProfile(
        makeInput({
          withholdingPolicy: 'CONFIGURED',
          withholdingRates: { irrf: '1.5' },
        }),
      ),
    ).toEqual([]);
  });

  it('rejects non-numeric, negative and over-100 withholding rates', () => {
    expect(
      validateServiceTaxProfile(
        makeInput({ withholdingRates: { irrf: 'abc' } }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        field: 'withholdingRates.irrf',
        code: 'invalid',
      }),
    );
    expect(
      validateServiceTaxProfile(
        makeInput({ withholdingRates: { inss: '-1' } }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        field: 'withholdingRates.inss',
        code: 'out_of_range',
      }),
    );
    expect(
      validateServiceTaxProfile(
        makeInput({ withholdingRates: { csll: '100.1' } }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        field: 'withholdingRates.csll',
        code: 'out_of_range',
      }),
    );
    expect(
      validateServiceTaxProfile(
        makeInput({ withholdingRates: { pis: '0', cofins: '100' } }),
      ),
    ).toEqual([]);
  });

  it('rejects unknown withholding rate keys', () => {
    const issues = validateServiceTaxProfile(
      makeInput({
        withholdingPolicy: 'CONFIGURED',
        withholdingRates: { irrf: '1', iss: '2' } as Record<string, string>,
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        field: 'withholdingRates.iss',
        code: 'unknown_field',
      }),
    );
  });

  it('applies the same numeric range rules to issRate', () => {
    expect(
      validateServiceTaxProfile(makeInput({ issRate: 'abc' })),
    ).toContainEqual(
      expect.objectContaining({ field: 'issRate', code: 'invalid' }),
    );
    expect(
      validateServiceTaxProfile(makeInput({ issRate: '101' })),
    ).toContainEqual(
      expect.objectContaining({ field: 'issRate', code: 'out_of_range' }),
    );
    expect(validateServiceTaxProfile(makeInput({ issRate: '5' }))).toEqual([]);
  });

  it('rejects effectiveUntil that is not after effectiveFrom', () => {
    expect(
      validateServiceTaxProfile(
        makeInput({
          effectiveFrom: '2026-06-01',
          effectiveUntil: '2026-06-01',
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        field: 'effectiveUntil',
        code: 'out_of_range',
      }),
    );
    expect(
      validateServiceTaxProfile(
        makeInput({
          effectiveFrom: '2026-06-01',
          effectiveUntil: '2026-01-01',
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        field: 'effectiveUntil',
        code: 'out_of_range',
      }),
    );
    expect(
      validateServiceTaxProfile(
        makeInput({
          effectiveFrom: '2026-06-01',
          effectiveUntil: '2027-01-01',
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a regime applicability entry outside the known regimes', () => {
    const issues = validateServiceTaxProfile(
      makeInput({
        regimeApplicability: ['SIMPLES_NACIONAL', 'FORA_TABELA' as never],
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        field: 'regimeApplicability',
        code: 'invalid_option',
      }),
    );
  });
});
