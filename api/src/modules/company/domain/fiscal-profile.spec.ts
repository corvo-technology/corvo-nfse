import {
  isEffectiveOn,
  legacyFromRegimeKind,
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
