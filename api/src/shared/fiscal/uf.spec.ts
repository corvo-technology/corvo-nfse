import { UF_CODES, isValidUf, normalizeUf } from './uf';

describe('uf', () => {
  it('has the 27 federative units', () => expect(UF_CODES).toHaveLength(27));
  it('normalizes to upper case', () => expect(normalizeUf(' df ')).toBe('DF'));
  it.each(['DF', 'sp', 'RJ'])('accepts %s', (v) =>
    expect(isValidUf(v)).toBe(true),
  );
  it.each(['', 'XX', 'D', 'DFF', '12'])('rejects %p', (v) =>
    expect(isValidUf(v)).toBe(false),
  );
});
