export function normalizeCep(value: string): string {
  return value.replace(/[.\s-]/g, '');
}

export function isValidCep(value: string): boolean {
  return /^\d{8}$/.test(normalizeCep(value));
}
