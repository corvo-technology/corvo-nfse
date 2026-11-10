import type { FiscalIssue } from '@/shared/fiscal/fiscal-validation-error';

/** Why a customer abroad has no tax id. Sent in the DPS as `cNaoNIF` (1 or 2). */
export const NO_TAX_ID_REASONS = ['exempt', 'not_required'] as const;
export type NoTaxIdReason = (typeof NO_TAX_ID_REASONS)[number];

/** A customer (tomador) outside Brazil: identified by NIF or by the reason it has none, with the address abroad. */
export interface ForeignCustomer {
  /** Tax id in the customer's country (DPS `NIF`). */
  taxId?: string;
  noTaxIdReason?: NoTaxIdReason;
  /** ISO 3166-1 alpha-2, never BR. */
  country: string;
  postalCode: string;
  city: string;
  region: string;
  street: string;
  number: string;
  district: string;
  complement?: string;
}

/** Limits of the XSD RTC v1.01 (TSNIF, TCEnderExt and TCEndereco). */
const LIMITS = {
  taxId: 40,
  postalCode: 11,
  city: 60,
  region: 60,
  street: 255,
  number: 60,
  district: 60,
  complement: 156,
} as const;
const REQUIRED_ADDRESS = [
  'postalCode',
  'city',
  'region',
  'street',
  'number',
  'district',
] as const;

const regions = new Intl.DisplayNames(['en'], {
  type: 'region',
  fallback: 'none',
});

function knownCountry(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code)) return false;
  try {
    return regions.of(code) !== undefined;
  } catch {
    return false;
  }
}

function text(
  raw: Record<string, unknown>,
  key: keyof typeof LIMITS,
  required: boolean,
  issues: FiscalIssue[],
): string | undefined {
  const field = `customer.foreign.${key}`;
  const value = raw[key];
  if (value === undefined || value === null || value === '') {
    if (required)
      issues.push({ field, code: 'required', message: `${field} is required` });
    return undefined;
  }
  if (typeof value !== 'string') {
    issues.push({
      field,
      code: 'invalid_type',
      message: `${field} must be text`,
    });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    if (required)
      issues.push({ field, code: 'required', message: `${field} is required` });
    return undefined;
  }
  if (trimmed.length > LIMITS[key]) {
    issues.push({
      field,
      code: 'too_long',
      message: `${field} must have at most ${LIMITS[key]} characters`,
    });
    return undefined;
  }
  return trimmed;
}

/**
 * Validates `customer.foreign`. A customer abroad replaces the CPF/CNPJ and the Brazilian address:
 * the DPS identifies it by NIF (or by the reason it has none) and requires the name and the address.
 */
export function normalizeForeignCustomer(
  customer: {
    name?: unknown;
    taxId?: unknown;
    address?: unknown;
    foreign?: unknown;
  },
  issues: FiscalIssue[],
): ForeignCustomer | undefined {
  const raw = customer.foreign;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push({
      field: 'customer.foreign',
      code: 'invalid_type',
      message: 'customer.foreign must be an object',
    });
    return undefined;
  }
  const before = issues.length;
  const data = raw as Record<string, unknown>;

  if (typeof customer.taxId === 'string' && customer.taxId.trim())
    issues.push({
      field: 'customer.taxId',
      code: 'not_allowed',
      message:
        'customer.taxId (CPF/CNPJ) cannot be sent with customer.foreign; a customer abroad is identified by customer.foreign.taxId',
    });
  const address = customer.address as Record<string, unknown> | undefined;
  if (
    address &&
    Object.values(address).some(
      (value) => typeof value === 'string' && value.trim(),
    )
  )
    issues.push({
      field: 'customer.address',
      code: 'not_allowed',
      message:
        'customer.address is the Brazilian address; send the address abroad in customer.foreign',
    });
  if (typeof customer.name !== 'string' || !customer.name.trim())
    issues.push({
      field: 'customer.name',
      code: 'required',
      message: 'customer.name is required for a customer abroad',
    });

  const taxId = text(data, 'taxId', false, issues);
  const reason = data.noTaxIdReason;
  const hasReason = reason !== undefined && reason !== null && reason !== '';
  let noTaxIdReason: NoTaxIdReason | undefined;
  if (hasReason && !NO_TAX_ID_REASONS.includes(reason as NoTaxIdReason)) {
    issues.push({
      field: 'customer.foreign.noTaxIdReason',
      code: 'invalid_option',
      message: `customer.foreign.noTaxIdReason must be one of: ${NO_TAX_ID_REASONS.join(', ')}`,
    });
  } else if (hasReason && data.taxId) {
    issues.push({
      field: 'customer.foreign.noTaxIdReason',
      code: 'not_allowed',
      message:
        'send customer.foreign.taxId or customer.foreign.noTaxIdReason, never both',
    });
  } else if (hasReason) {
    noTaxIdReason = reason as NoTaxIdReason;
  } else if (!data.taxId) {
    issues.push({
      field: 'customer.foreign.taxId',
      code: 'required',
      message:
        'customer.foreign.taxId is required; when the customer has no tax id, send customer.foreign.noTaxIdReason',
    });
  }

  const country =
    typeof data.country === 'string' ? data.country.trim().toUpperCase() : '';
  if (!knownCountry(country) || country === 'BR')
    issues.push({
      field: 'customer.foreign.country',
      code: country ? 'invalid_option' : 'required',
      message:
        'customer.foreign.country must be an ISO 3166-1 alpha-2 country code other than BR',
    });

  const [postalCode, city, region, street, number, district] =
    REQUIRED_ADDRESS.map((key) => text(data, key, true, issues));
  const complement = text(data, 'complement', false, issues);

  if (issues.length > before) return undefined;
  return {
    ...(taxId !== undefined ? { taxId } : {}),
    ...(noTaxIdReason !== undefined ? { noTaxIdReason } : {}),
    country,
    postalCode: postalCode!,
    city: city!,
    region: region!,
    street: street!,
    number: number!,
    district: district!,
    ...(complement !== undefined ? { complement } : {}),
  };
}
