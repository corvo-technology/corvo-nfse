import { HttpException } from '@nestjs/common';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { isApplicationError } from '@/shared/errors/application-error';
import {
  DOMAIN_ERRORS,
  apiErrorBody,
  publicErrorCode,
} from '@/shared/http/api-error';

export type BatchItemError = {
  code: string;
  message: string;
  details?: unknown;
};

/**
 * Per-item version of what DomainExceptionFilter does for a whole request.
 * Returns null for anything unexpected: the caller must rethrow it, so an
 * infrastructure failure fails the batch instead of hiding as a rejected item.
 */
export function toBatchItemError(error: unknown): BatchItemError | null {
  if (error instanceof FiscalValidationError) {
    const { code, message, details } = apiErrorBody(
      422,
      {
        code: 'validation_error',
        message: 'Request validation failed',
        details: error.issues,
      },
      'batch',
    );
    return { code, message, ...(details ? { details } : {}) };
  }
  if (error instanceof HttpException && error.getStatus() < 500) {
    const { code, message, details } = apiErrorBody(
      error.getStatus(),
      error.getResponse(),
      'batch',
    );
    return { code, message, ...(details ? { details } : {}) };
  }
  if (isApplicationError(error))
    return {
      code: publicErrorCode(error.code, 'ERROR_BAD_REQUEST'),
      message: error.safeMessage,
    };
  const domain = error instanceof Error ? DOMAIN_ERRORS[error.name] : undefined;
  if (domain && domain.status < 500)
    return { code: domain.code, message: domain.message };
  return null;
}
