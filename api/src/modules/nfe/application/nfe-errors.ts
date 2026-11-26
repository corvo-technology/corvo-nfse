import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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

/** 400: `POST /v1/nfe` and `PUT /v1/nfe/{id}` need the header, so a retry can never issue twice. */
export function nfeIdempotencyKeyRequired(): BadRequestException {
  return new BadRequestException({
    code: 'IDEMPOTENCY_KEY_REQUIRED',
    message: 'The Idempotency-Key header is required to issue an NF-e',
  });
}

/** 400: the key must have 1 to 200 characters. */
export function nfeIdempotencyKeyInvalid(): BadRequestException {
  return new BadRequestException({
    code: 'IDEMPOTENCY_KEY_INVALID',
    message: 'The Idempotency-Key must have 1 to 200 characters',
  });
}

/** 409: the same key came with another body. */
export function nfeIdempotencyKeyReused(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'This Idempotency-Key was already used with a different body',
  });
}

/** 409: the operation does not apply to the state the NF-e is in. */
export function nfeInvalidState(
  status: string,
  operation: string,
): ConflictException {
  return new ConflictException({
    code: 'NFE_INVALID_STATE',
    message: `An NF-e in the state '${status}' cannot be ${operation}`,
  });
}

/** 404, same answer as a route that does not exist (and as another tenant's document). */
export function nfeNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message: 'Resource not found',
  });
}
