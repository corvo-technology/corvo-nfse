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

/** 400: `POST /v1/invoices` (`type: "nfe"`) and `PUT /v1/invoices/{id}` need the header, so a retry can never issue twice. */
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

/** 409: the XML and the DANFE are not stored yet (or the NF-e never got authorized). */
export function nfeDocumentsNotReady(): ConflictException {
  return new ConflictException({
    code: 'DOCUMENTS_NOT_READY',
    message: 'Documents not ready',
  });
}

const lengthIssue = (field: string, code: string, message: string) => ({
  field,
  code,
  message,
});

/** 422 `validation`: the justification of a cancellation or inutilization must have 15 to 255 characters. */
export function nfeJustificationLength(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'JUSTIFICATION_LENGTH',
    message: 'The justification must have 15 to 255 characters',
    type: 'validation',
    details: [
      lengthIssue(
        'justification',
        'JUSTIFICATION_LENGTH',
        'Use between 15 and 255 characters',
      ),
    ],
  });
}

/** 422 `validation`: a correction letter has 15 to 1000 characters. */
export function nfeCorrectionLength(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'CORRECTION_LENGTH',
    message: 'The correction must have 15 to 1000 characters',
    type: 'validation',
    details: [
      lengthIssue(
        'correction',
        'CORRECTION_LENGTH',
        'Use between 15 and 1000 characters',
      ),
    ],
  });
}

/** 422: an NF-e takes at most 20 correction letters. */
export function nfeCorrectionLimit(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'CORRECTION_LIMIT_REACHED',
    message: 'An NF-e accepts at most 20 correction letters',
    type: 'validation',
  });
}

/** 422: `start` is after `end`, or a number is outside 1 to 999999999. */
export function nfeInutilizationRangeInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INUTILIZATION_RANGE_INVALID',
    message: 'The range must go from 1 to 999999999, with start not after end',
    type: 'validation',
  });
}

/** 409: the range holds an NF-e that is not `discarded`. */
export function nfeInutilizationRangeInUse(): ConflictException {
  return new ConflictException({
    code: 'INUTILIZATION_RANGE_IN_USE',
    message: 'An NF-e that is not discarded uses a number of this range',
  });
}

/** 409: another inutilization (waiting or approved) covers part of the range. */
export function nfeInutilizationRangeOverlap(): ConflictException {
  return new ConflictException({
    code: 'INUTILIZATION_RANGE_OVERLAP',
    message: 'Another inutilization already covers part of this range',
  });
}

/** 422 `configuration`: `live` is closed while NF-e is homologation only. */
export function nfeProductionDisabled(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'NFE_PRODUCTION_DISABLED',
    message: 'NF-e em produção ainda não liberada',
    type: 'configuration',
  });
}

/** 422 `configuration`: the company has no usable certificate in this environment. */
export function nfeCertificateProblem(
  code: string,
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code,
    message,
    type: 'configuration',
  });
}
