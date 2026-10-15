import { fiscalError } from '../domain/fiscal/fiscal-error';
import { calculationHttpFailure } from './fiscal-error-http';

describe('calculationHttpFailure', () => {
  it.each([
    [2500, 3],
    [0, 1],
    [-1000, 1],
    [undefined, 5],
    [Number.NaN, 5],
  ])(
    'maps INTEGRATION to retryable dependency with retryAfterMs %s',
    (retryAfterMs, seconds) => {
      const failure = calculationHttpFailure(
        fiscalError({
          code: 'TAX_CALCULATION_UNAVAILABLE',
          category: 'INTEGRATION',
          message: 'private dependency error',
          details: { retryAfterMs },
        }),
      );
      expect(failure.retryAfterSeconds).toBe(seconds);
      expect(failure.exception).toMatchObject({
        kind: 'dependency',
        retryable: true,
        safeMessage: 'Fiscal calculation is temporarily unavailable',
      });
      expect(failure.exception.message).not.toContain('private');
    },
  );
  it('hides internal details behind a generic 500', () => {
    const failure = calculationHttpFailure(
      fiscalError({
        code: 'FISCAL_INTERNAL_ERROR',
        category: 'INTERNAL',
        message: 'private stack',
      }),
    );
    expect(failure.exception).toMatchObject({
      kind: 'internal',
      safeMessage: 'Internal server error',
    });
    expect(failure.exception.message).not.toContain('private');
    expect(failure.retryAfterSeconds).toBeUndefined();
  });
});
