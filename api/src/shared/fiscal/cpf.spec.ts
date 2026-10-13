import { isValidCpf, normalizeCpf } from './cpf';

describe('cpf', () => {
  it('normalizes punctuation', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
  });
  it.each(['52998224725', '529.982.247-25'])('accepts %s', (v) =>
    expect(isValidCpf(v)).toBe(true),
  );
  it.each([
    '',
    '52998224724',
    '1234567890',
    '123456789012',
    '11111111111',
    '00000000000',
    'abcdefghijk',
  ])('rejects %p', (v) => expect(isValidCpf(v)).toBe(false));
});
