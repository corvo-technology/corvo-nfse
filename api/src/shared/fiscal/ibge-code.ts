export function isValidIbgeCode(value: string): boolean {
  return /^\d{7}$/.test(value);
}
