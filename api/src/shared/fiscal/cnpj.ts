// IMPORTANT: no cycle with tax-id.ts — inline normalization
export function normalizeCnpj(value: string): string {
  return value.replace(/[.\s/-]/g, '').toUpperCase();
}

const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(chars: string, weights: number[]): number {
  const sum = weights.reduce(
    (total, weight, index) => total + (chars.charCodeAt(index) - 48) * weight,
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(.)\1+$/.test(cnpj)) return false;
  const first = checkDigit(cnpj, FIRST_WEIGHTS);
  if (first !== Number(cnpj[12])) return false;
  const second = checkDigit(cnpj, SECOND_WEIGHTS);
  return second === Number(cnpj[13]);
}
