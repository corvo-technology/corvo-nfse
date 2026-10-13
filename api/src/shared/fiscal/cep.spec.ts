import { isValidCep, normalizeCep } from './cep';

describe('cep', () => {
  it('normalizes', () => expect(normalizeCep('70040-010')).toBe('70040010'));
  it.each(['70040010', '70040-010'])('accepts %s', (v) =>
    expect(isValidCep(v)).toBe(true),
  );
  it.each(['', '7004001', '700400101', 'abcdefgh', '70040 01'])(
    'rejects %p',
    (v) => expect(isValidCep(v)).toBe(false),
  );
});
