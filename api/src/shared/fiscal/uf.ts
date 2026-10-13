export const UF_CODES: readonly string[] = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
];

export function normalizeUf(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidUf(value: string): boolean {
  return UF_CODES.includes(normalizeUf(value));
}
