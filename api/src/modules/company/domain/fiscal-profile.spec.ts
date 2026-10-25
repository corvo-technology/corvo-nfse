import {
  effectiveProfilesOn,
  isEffectiveOn,
  legacyFromRegimeKind,
  regApTribSNFor,
  regimeKindFromLegacy,
} from './fiscal-profile';

describe('fiscal profile dates', () => {
  const p = { validFrom: '2026-03-01', validUntil: '2026-09-01' };
  it.each([
    ['2026-02-28', false],
    ['2026-03-01', true],
    ['2026-08-31', true],
    ['2026-09-01', false],
  ])('%s -> %s', (d, expected) => expect(isEffectiveOn(p, d)).toBe(expected));
  it('open-ended profile stays effective', () =>
    expect(
      isEffectiveOn(
        { validFrom: '2026-03-01', validUntil: null },
        '2099-01-01',
      ),
    ).toBe(true));
});

describe('legacy regime mapping', () => {
  it('round trips the four legacy values', () => {
    for (const legacy of [
      'MEI',
      'Simples Nacional',
      'Lucro Presumido',
      'Lucro Real',
    ] as const)
      expect(legacyFromRegimeKind(regimeKindFromLegacy(legacy))).toBe(legacy);
  });
  it('has no legacy label for UNKNOWN', () =>
    expect(legacyFromRegimeKind('UNKNOWN')).toBeNull());
});

describe('effectiveProfilesOn', () => {
  const profile = (
    id: string,
    validFrom: string,
    validUntil: string | null,
  ) => ({
    id,
    validFrom,
    validUntil,
  });
  const history = [
    profile('old', '2026-03-01', '2026-06-01'),
    profile('current', '2026-06-01', null),
  ];

  it('picks the profile whose window covers the date', () => {
    expect(effectiveProfilesOn(history, '2026-04-15')).toEqual([history[0]]);
    expect(effectiveProfilesOn(history, '2026-06-01')).toEqual([history[1]]);
  });

  it('applies the first profile backwards: a company existed before it was registered', () => {
    expect(effectiveProfilesOn(history, '2026-01-10')).toEqual([history[0]]);
    expect(effectiveProfilesOn(history, '2020-01-01')).toEqual([history[0]]);
  });

  it('applies a single profile backwards too', () => {
    const only = [profile('only', '2026-10-24', null)];

    expect(effectiveProfilesOn(only, '2026-09-30')).toEqual(only);
  });

  it('does not invent a profile inside a gap, or when the company has none', () => {
    const gap = [
      profile('a', '2026-01-01', '2026-03-01'),
      profile('b', '2026-05-01', null),
    ];

    expect(effectiveProfilesOn(gap, '2026-04-10')).toEqual([]);
    expect(effectiveProfilesOn([], '2026-04-10')).toEqual([]);
  });

  it('keeps reporting overlapping profiles so the engine can refuse them', () => {
    const overlap = [
      profile('a', '2026-01-01', null),
      profile('b', '2026-02-01', null),
    ];

    expect(effectiveProfilesOn(overlap, '2026-03-01')).toHaveLength(2);
  });
});

describe('regApTribSNFor', () => {
  const base = { simplesApuracao: undefined } as const;

  it('is 1 for Simples Nacional, with or without an explicit SN', () => {
    expect(regApTribSNFor({ taxRegime: 'SIMPLES_NACIONAL', ...base })).toBe(1);
    expect(
      regApTribSNFor({ taxRegime: 'SIMPLES_NACIONAL', simplesApuracao: 'SN' }),
    ).toBe(1);
  });

  it('is 2 and 3 for the sublimit options', () => {
    expect(
      regApTribSNFor({
        taxRegime: 'SIMPLES_NACIONAL',
        simplesApuracao: 'ISS_MUNICIPAL',
      }),
    ).toBe(2);
    expect(
      regApTribSNFor({
        taxRegime: 'SIMPLES_NACIONAL',
        simplesApuracao: 'REGULAR',
      }),
    ).toBe(3);
  });

  it('is null for MEI and for other regimes (E0162)', () => {
    for (const taxRegime of ['MEI', 'LUCRO_REAL'] as const)
      expect(regApTribSNFor({ taxRegime, ...base })).toBeNull();
  });
});
