import { crtForRegime } from './nfe-settings';

describe('crtForRegime', () => {
  it('maps Simples Nacional to 1 and MEI to 4', () => {
    expect(crtForRegime('SIMPLES_NACIONAL')).toBe(1);
    expect(crtForRegime('MEI')).toBe(4);
  });

  it('has no CRT for the other regimes or an unknown profile', () => {
    for (const regime of [
      'LUCRO_PRESUMIDO',
      'LUCRO_REAL',
      'OUTRO_REGIME',
      'UNKNOWN',
      null,
      undefined,
    ])
      expect(crtForRegime(regime)).toBeNull();
  });
});
