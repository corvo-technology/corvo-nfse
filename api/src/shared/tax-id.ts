/**
 * Normalize a tax ID (CPF/CNPJ) by removing punctuation and converting to uppercase.
 * Preserves letters — supports the new alphanumeric CNPJ format (IN RFB 2.229/2024).
 *
 * Examples:
 *   FD.NKX.YDC/0001-93 → FDNKXYDC000193
 *   11.307.752/0001-16 → 11307752000116
 *   11307752000116    → 11307752000116 (idempotent)
 */
import { isValidCnpj } from './fiscal/cnpj';
import { isValidCpf } from './fiscal/cpf';

export function parseCustomerTaxId(
  value: string,
): { kind: 'CPF' | 'CNPJ'; value: string } | null {
  const normalized = normalizeTaxID(value);
  if (!normalized) return null;
  if (normalized.length === 11 && isValidCpf(normalized))
    return { kind: 'CPF', value: normalized };
  if (normalized.length === 14 && isValidCnpj(normalized))
    return { kind: 'CNPJ', value: normalized };
  return null;
}

export function normalizeTaxID(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[.\s/-]/g, '').toUpperCase();
  return cleaned.length > 0 ? cleaned : undefined;
}
