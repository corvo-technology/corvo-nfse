import { deductionAllowed } from './deduction-policy';

describe('deductionAllowed (Anexo I E0436, E0441, E0442)', () => {
  it('E0436: MEI never allows a deduction', () => {
    expect(
      deductionAllowed({
        taxRegime: 'MEI',
        cTribNac: '060101',
        regApTribSN: null,
      }),
    ).toMatchObject({ allowed: false });
  });

  it('E0441/E0442: Simples with regApTribSN 1 allows only the listed cTribNac', () => {
    expect(
      deductionAllowed({
        taxRegime: 'SIMPLES_NACIONAL',
        cTribNac: '060101',
        regApTribSN: 1,
      }),
    ).toEqual({ allowed: true });
    const refused = deductionAllowed({
      taxRegime: 'SIMPLES_NACIONAL',
      cTribNac: '010101',
      regApTribSN: 1,
    });
    expect(refused).toMatchObject({ allowed: false });
    expect(refused.allowed === false && refused.reason).toContain('010101');
  });

  it('does not apply the Simples list when the ISS is not apportioned by the Simples', () => {
    expect(
      deductionAllowed({
        taxRegime: 'SIMPLES_NACIONAL',
        cTribNac: '010101',
        regApTribSN: 2,
      }),
    ).toEqual({ allowed: true });
  });

  it('leaves other regimes to their own rules', () => {
    expect(
      deductionAllowed({
        taxRegime: 'LUCRO_PRESUMIDO',
        cTribNac: '010101',
        regApTribSN: null,
      }),
    ).toEqual({ allowed: true });
  });
});
