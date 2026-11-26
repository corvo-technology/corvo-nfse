import { UnprocessableEntityException } from '@nestjs/common';
import type { NfePreconditionError } from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';

/** 422 with `type: 'validation'`: the customer fixes the fields listed in `details`. */
export function nfeValidationFailed(
  issues: ValidationIssue[],
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'NFE_VALIDATION_FAILED',
    message: 'The NF-e has problems; see details',
    type: 'validation',
    details: issues,
  });
}

/** 422 with `type: 'configuration'`: something is missing in the company or in the release. */
export function nfeConfigurationError(
  error: Pick<NfePreconditionError, 'code' | 'message' | 'details'>,
): UnprocessableEntityException {
  const missing = error.details.missing;
  return new UnprocessableEntityException({
    code: error.code,
    message: error.message,
    type: 'configuration',
    details: Array.isArray(missing)
      ? missing.map((field: unknown) => ({
          field: String(field),
          code: error.code,
          message: `The company lacks ${String(field)}`,
        }))
      : error.details,
  });
}
