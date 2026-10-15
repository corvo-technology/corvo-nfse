import { ApplicationError } from '@/shared/errors/application-error';
import type { FiscalError } from '../domain/fiscal/fiscal-error';

export function calculationHttpFailure(error: FiscalError): {
  exception: ApplicationError;
  retryAfterSeconds?: number;
} {
  if (error.category === 'INTEGRATION') {
    const milliseconds = error.details.retryAfterMs;
    const retryAfterSeconds =
      typeof milliseconds === 'number' && Number.isFinite(milliseconds)
        ? Math.max(1, Math.ceil(milliseconds / 1000))
        : 5;
    return {
      retryAfterSeconds,
      exception: new ApplicationError({
        code: error.code,
        kind: 'dependency',
        retryable: true,
        safeMessage: 'Fiscal calculation is temporarily unavailable',
      }),
    };
  }
  return {
    exception: new ApplicationError({
      code: 'FISCAL_INTERNAL_ERROR',
      kind: 'internal',
      safeMessage: 'Internal server error',
    }),
  };
}
