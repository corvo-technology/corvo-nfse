import { TaxRegimeNotSupportedError } from './errors';
import { assertRegimeSupported } from './tax-regime-support';

describe('assertRegimeSupported', () => {
  it.each([
    'LUCRO_PRESUMIDO',
    'LUCRO_REAL',
    'OUTRO_REGIME',
    'UNKNOWN',
  ] as const)('refuses %s', (regime) => {
    expect(() => assertRegimeSupported(regime)).toThrow(
      TaxRegimeNotSupportedError,
    );
  });

  it.each(['MEI', 'SIMPLES_NACIONAL'] as const)('accepts %s', (regime) => {
    expect(() => assertRegimeSupported(regime)).not.toThrow();
  });
});
