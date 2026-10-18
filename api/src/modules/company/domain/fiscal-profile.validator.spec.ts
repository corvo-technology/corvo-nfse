import { validateFiscalProfile } from './fiscal-profile.validator';
import type { NewFiscalProfile } from './fiscal-profile.repository';

const makeInput = (
  overrides: Partial<NewFiscalProfile> = {},
): NewFiscalProfile => ({
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  simplesIssRate: null,
  validFrom: '2026-06-01',
  source: 'manual',
  reviewStatus: 'unreviewed',
  reviewedBy: null,
  ...overrides,
});

describe('validateFiscalProfile', () => {
  it('accepts a profile without simplesIssRate', () => {
    expect(validateFiscalProfile(makeInput())).toEqual([]);
  });

  it('accepts the boundary values 1.80 and 5.00', () => {
    expect(
      validateFiscalProfile(makeInput({ simplesIssRate: '1.80' })),
    ).toEqual([]);
    expect(
      validateFiscalProfile(makeInput({ simplesIssRate: '5.00' })),
    ).toEqual([]);
  });

  it('rejects a non-numeric simplesIssRate', () => {
    const issues = validateFiscalProfile(makeInput({ simplesIssRate: 'abc' }));
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'simplesIssRate', code: 'invalid' }),
    );
  });

  it('rejects a simplesIssRate with more than 2 decimal places', () => {
    const issues = validateFiscalProfile(
      makeInput({ simplesIssRate: '2.015' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        field: 'simplesIssRate',
        code: 'invalid_decimal_places',
      }),
    );
  });

  it('rejects a simplesIssRate below the 1.80 floor', () => {
    const issues = validateFiscalProfile(makeInput({ simplesIssRate: '1.79' }));
    expect(issues).toContainEqual(
      expect.objectContaining({
        field: 'simplesIssRate',
        code: 'out_of_range',
      }),
    );
  });

  it('rejects a simplesIssRate above the 5.00 ceiling', () => {
    const issues = validateFiscalProfile(makeInput({ simplesIssRate: '5.01' }));
    expect(issues).toContainEqual(
      expect.objectContaining({
        field: 'simplesIssRate',
        code: 'out_of_range',
      }),
    );
  });
});
