import { registryWarnings, type RegistryInfo } from './registry-check';

const info = (over: Partial<RegistryInfo> = {}): RegistryInfo => ({
  optanteSimples: true,
  optanteMei: false,
  municipalityCode: '3550308',
  ...over,
});

describe('registryWarnings', () => {
  it('has no warning when the registry agrees', () => {
    expect(
      registryWarnings(
        info({ optanteMei: true, optanteSimples: true }),
        'MEI',
        '3550308',
      ),
    ).toEqual([]);
    expect(registryWarnings(info(), 'SIMPLES_NACIONAL', '3550308')).toEqual([]);
  });

  it('warns when a MEI is not a MEI in the registry', () => {
    const warnings = registryWarnings(
      info({ optanteMei: false }),
      'MEI',
      '3550308',
    );
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'TAX_REGIME_REGISTRY_MISMATCH' }),
    ]);
  });

  it('warns when a Simples company is a MEI or not in the Simples in the registry', () => {
    expect(
      registryWarnings(
        info({ optanteMei: true }),
        'SIMPLES_NACIONAL',
        '3550308',
      ),
    ).toEqual([
      expect.objectContaining({ code: 'TAX_REGIME_REGISTRY_MISMATCH' }),
    ]);
    expect(
      registryWarnings(
        info({ optanteSimples: false }),
        'SIMPLES_NACIONAL',
        '3550308',
      ),
    ).toEqual([
      expect.objectContaining({ code: 'TAX_REGIME_REGISTRY_MISMATCH' }),
    ]);
  });

  it('warns when the MEI municipality differs from the registry address (E0041)', () => {
    const warnings = registryWarnings(
      info({ optanteMei: true, municipalityCode: '3170206' }),
      'MEI',
      '3550308',
    );
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'MEI_MUNICIPALITY_MISMATCH' }),
    ]);
  });

  it('does not check the municipality of a Simples ME/EPP', () => {
    expect(
      registryWarnings(
        info({ municipalityCode: '3170206' }),
        'SIMPLES_NACIONAL',
        '3550308',
      ),
    ).toEqual([]);
  });

  it('never warns on missing information or an unknown registry', () => {
    expect(registryWarnings(null, 'MEI', '3550308')).toEqual([]);
    expect(
      registryWarnings(
        info({
          optanteSimples: null,
          optanteMei: null,
          municipalityCode: null,
        }),
        'MEI',
        '3550308',
      ),
    ).toEqual([]);
  });

  it('only checks MEI and Simples Nacional', () => {
    expect(registryWarnings(info(), 'LUCRO_REAL', '3550308')).toEqual([]);
  });
});
