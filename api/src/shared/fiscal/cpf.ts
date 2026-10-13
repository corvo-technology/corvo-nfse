export function normalizeCpf(value: string): string {
  return value.replace(/[.\s-]/g, '');
}

function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += Number(digits[index]) * (length + 1 - index);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  return (
    checkDigit(cpf, 9) === Number(cpf[9]) &&
    checkDigit(cpf, 10) === Number(cpf[10])
  );
}
