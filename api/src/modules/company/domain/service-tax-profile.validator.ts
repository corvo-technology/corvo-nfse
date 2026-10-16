import type { FiscalIssue } from '@/shared/fiscal/fiscal-validation-error';
import type { NewServiceTaxProfile } from './service-tax-profile.repository';
import { TAX_REGIME_KINDS } from './fiscal-profile';

/** The only withholding rate keys the fiscal engine understands. */
export const WITHHOLDING_RATE_KEYS = [
  'irrf',
  'pis',
  'cofins',
  'csll',
  'inss',
] as const;

const MAX_NAME_LENGTH = 120;

function isConfiguredRate(value: string | undefined): boolean {
  return value !== undefined && value !== null && value.trim() !== '';
}

function rateIssues(field: string, value: string): FiscalIssue[] {
  const numeric = value.trim() !== '' && Number.isFinite(Number(value));
  if (!numeric) {
    return [
      {
        field,
        code: 'invalid',
        message: `${field} must be a numeric percentage string`,
      },
    ];
  }
  if (Number(value) < 0 || Number(value) > 100) {
    return [
      {
        field,
        code: 'out_of_range',
        message: `${field} must be between 0 and 100`,
      },
    ];
  }
  return [];
}

/**
 * Structural and range validation for a service tax profile. Fiscal coherence
 * beyond formats (e.g. ISS exemption vs. rate) is the fiscal engine's concern.
 */
export function validateServiceTaxProfile(
  input: NewServiceTaxProfile,
): FiscalIssue[] {
  const issues: FiscalIssue[] = [];

  if (!/^\d{6}$/.test(input.serviceCode)) {
    issues.push({
      field: 'serviceCode',
      code: 'invalid',
      message: 'serviceCode must be a 6-digit cTribNac code',
    });
  }

  if (input.name.trim() === '') {
    issues.push({
      field: 'name',
      code: 'blank',
      message: 'name is required',
    });
  } else if (input.name.length > MAX_NAME_LENGTH) {
    issues.push({
      field: 'name',
      code: 'too_long',
      message: `name must be at most ${MAX_NAME_LENGTH} characters`,
    });
  }

  if (input.issRate !== null && input.issRate !== undefined) {
    issues.push(...rateIssues('issRate', input.issRate));
  }

  let configuredRates = 0;
  for (const [key, value] of Object.entries(input.withholdingRates)) {
    if (!(WITHHOLDING_RATE_KEYS as readonly string[]).includes(key)) {
      issues.push({
        field: `withholdingRates.${key}`,
        code: 'unknown_field',
        message: `withholdingRates.${key} is not a supported withholding rate`,
      });
      continue;
    }
    if (isConfiguredRate(value)) {
      configuredRates += 1;
      issues.push(...rateIssues(`withholdingRates.${key}`, value));
    }
  }

  if (input.withholdingPolicy === 'CONFIGURED' && configuredRates === 0) {
    issues.push({
      field: 'withholdingRates',
      code: 'required',
      message:
        'withholdingPolicy CONFIGURED requires at least one withholding rate',
    });
  }

  if (
    input.effectiveUntil !== null &&
    input.effectiveUntil !== undefined &&
    input.effectiveUntil <= input.effectiveFrom
  ) {
    issues.push({
      field: 'effectiveUntil',
      code: 'out_of_range',
      message: 'effectiveUntil must be after effectiveFrom',
    });
  }

  if (
    input.regimeApplicability.some(
      (regime) => !(TAX_REGIME_KINDS as readonly string[]).includes(regime),
    )
  ) {
    issues.push({
      field: 'regimeApplicability',
      code: 'invalid_option',
      message: 'regimeApplicability contains an unknown tax regime',
    });
  }

  return issues;
}
