import { isValidCnpj, normalizeCnpj } from './cnpj';

describe('cnpj', () => {
  it.each([
    ['11222333000181', '11222333000181'],
    ['11.222.333/0001-81', '11222333000181'],
    ['12.abc.345/01de-35', '12ABC34501DE35'],
    [' 11222333000181 ', '11222333000181'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeCnpj(input)).toBe(expected);
  });

  it.each([
    '11222333000181',
    '11.222.333/0001-81',
    '12ABC34501DE35',
    '12.abc.345/01de-35',
  ])('accepts valid %s', (value) => expect(isValidCnpj(value)).toBe(true));

  it.each([
    '',
    '11222333000180', // wrong digit
    '1122233300018', // 13 chars
    '112223330001811', // 15 chars
    '00000000000000', // repeated
    '11111111111111',
    '12ABC34501DEAB', // non-numeric DV
    '11222333/000181!',
  ])('rejects %p', (value) => expect(isValidCnpj(value)).toBe(false));
});
