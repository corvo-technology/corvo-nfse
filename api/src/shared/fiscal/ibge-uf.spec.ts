import { ufFromIbge } from './ibge-uf';

describe('ufFromIbge', () => {
  it('maps São Paulo municipality 3550308 to SP', () => {
    expect(ufFromIbge('3550308')).toBe('SP');
  });

  it('maps Brasília 5300108 to DF', () => {
    expect(ufFromIbge('5300108')).toBe('DF');
  });

  it('returns null for an unknown prefix', () => {
    expect(ufFromIbge('9999999')).toBeNull();
  });

  it('returns null for a non-numeric code', () => {
    expect(ufFromIbge('abc')).toBeNull();
  });
});
