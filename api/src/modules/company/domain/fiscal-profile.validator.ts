import type { FiscalIssue } from '@/shared/fiscal/fiscal-validation-error';
import type { NewFiscalProfile } from './fiscal-profile.repository';

const SIMPLES_ISS_RATE_MIN = 1.8;
const SIMPLES_ISS_RATE_MAX = 5;

function decimalPlaces(value: string): number {
  const [, fraction] = value.split('.');
  return fraction?.length ?? 0;
}

/**
 * Structural and range validation for a company fiscal profile. Fiscal
 * coherence beyond formats is the fiscal engine's concern.
 */
export function validateFiscalProfile(input: NewFiscalProfile): FiscalIssue[] {
  const issues: FiscalIssue[] = [];
  const { simplesIssRate } = input;

  if (simplesIssRate !== null && simplesIssRate !== undefined) {
    const numeric =
      simplesIssRate.trim() !== '' && Number.isFinite(Number(simplesIssRate));
    if (!numeric) {
      issues.push({
        field: 'simplesIssRate',
        code: 'invalid',
        message: 'simplesIssRate must be a numeric percentage string',
      });
    } else if (decimalPlaces(simplesIssRate) > 2) {
      issues.push({
        field: 'simplesIssRate',
        code: 'invalid_decimal_places',
        message: 'simplesIssRate must have at most 2 decimal places',
      });
    } else if (
      Number(simplesIssRate) < SIMPLES_ISS_RATE_MIN ||
      Number(simplesIssRate) > SIMPLES_ISS_RATE_MAX
    ) {
      issues.push({
        field: 'simplesIssRate',
        code: 'out_of_range',
        message: `simplesIssRate must be between ${SIMPLES_ISS_RATE_MIN} and ${SIMPLES_ISS_RATE_MAX}`,
      });
    }
  }

  return issues;
}
