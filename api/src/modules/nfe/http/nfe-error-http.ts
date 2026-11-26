import { explainCstat } from '@/infra/external/nfe/sefaz/cstat';
import type { NfePreconditionError } from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { NfeDocumentSnapshot, NfeErrorType } from '../domain/nfe-document';

/**
 * The error as the customer reads it. `type` says who acts: `communication` (nobody: Corvo looks
 * again), `validation` (fix the fields in `issues`, or the SEFAZ rejected the note) or
 * `configuration` (complete the company or wait for the release).
 */
export interface NfeHttpError {
  type: NfeErrorType;
  code: string;
  message: string;
  hint?: string;
  issues?: ValidationIssue[];
}

export interface NfeHttpErrorBody {
  error: NfeHttpError;
}

function isIssues(source: unknown): source is ValidationIssue[] {
  return Array.isArray(source);
}

function isPrecondition(source: unknown): source is NfePreconditionError {
  return (
    typeof source === 'object' &&
    source !== null &&
    'category' in source &&
    source.category === 'CONFIGURATION'
  );
}

/**
 * - an NF-e document: its `lastError` (`null` when it has none); a SEFAZ rejection carries the
 *   hint of its cStat;
 * - a precondition failure (`FiscalError`-shaped): `configuration`;
 * - a list of validation issues: `validation`, with the fields.
 */
export function toNfeHttpError(
  source: NfeDocumentSnapshot | NfePreconditionError | ValidationIssue[],
): NfeHttpErrorBody | null {
  if (isIssues(source))
    return {
      error: {
        type: 'validation',
        code: 'NFE_VALIDATION_FAILED',
        message: 'The NF-e has problems; see issues',
        issues: source,
      },
    };
  if (isPrecondition(source))
    return {
      error: {
        type: 'configuration',
        code: source.code,
        message: source.message,
      },
    };
  if (!source.lastErrorType || !source.lastErrorCode) return null;
  const hint =
    source.lastErrorType === 'validation'
      ? explainCstat(source.lastErrorCode)
      : undefined;
  return {
    error: {
      type: source.lastErrorType,
      code: source.lastErrorCode,
      message: source.lastErrorMessage ?? '',
      ...(hint ? { hint } : {}),
    },
  };
}
