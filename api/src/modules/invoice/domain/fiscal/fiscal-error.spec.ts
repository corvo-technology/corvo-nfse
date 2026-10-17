import { fiscalError } from './fiscal-error';

describe('fiscalError', () => {
  it('builds a frozen non-retryable error by default', () => {
    const e = fiscalError({
      code: 'FISCAL_PROFILE_MISSING',
      message: 'm',
      category: 'CONFIGURATION',
    });
    expect(e).toEqual({
      code: 'FISCAL_PROFILE_MISSING',
      message: 'm',
      step: '',
      details: {},
      retryable: false,
      category: 'CONFIGURATION',
    });
    expect(Object.isFrozen(e)).toBe(true);
  });
  it('only INTEGRATION errors may be retryable', () => {
    expect(() =>
      fiscalError({
        code: 'TAX_RATE_NOT_FOUND',
        message: 'm',
        category: 'CALCULATION',
        retryable: true,
      }),
    ).toThrow();
    expect(
      fiscalError({
        code: 'TAX_CALCULATION_UNAVAILABLE',
        message: 'm',
        category: 'INTEGRATION',
        retryable: true,
      }).retryable,
    ).toBe(true);
  });
  it('keeps structured details', () => {
    const e = fiscalError({
      code: 'FISCAL_CLASSIFICATION_REQUIRED',
      message: 'm',
      category: 'CLASSIFICATION',
      details: { missingFields: ['service.fiscal.nbsCode'] },
    });
    expect(e.details).toEqual({ missingFields: ['service.fiscal.nbsCode'] });
  });
});
