export const FISCAL_ERROR_CODES = [
  'FISCAL_PROFILE_MISSING',
  'FISCAL_PROFILE_NOT_EFFECTIVE',
  'FISCAL_CLASSIFICATION_REQUIRED',
  'FISCAL_CLASSIFICATION_INVALID',
  'FISCAL_CLASSIFICATION_AMBIGUOUS',
  'TAX_APPLICABILITY_UNKNOWN',
  'TAX_REGIME_UNSUPPORTED',
  'TAX_RATE_NOT_FOUND',
  'TAX_CALCULATION_UNAVAILABLE',
  'TAX_CALCULATION_UNSUPPORTED',
  'TAX_RULE_NOT_EFFECTIVE',
  'FISCAL_VALIDATION_FAILED',
  'FISCAL_REVIEW_REQUIRED',
  'OPERATION_DOCUMENT_UNSUPPORTED',
  'DPS_LAYOUT_UNSUPPORTED',
  'DPS_SCHEMA_VALIDATION_FAILED',
  'FISCAL_INTERNAL_ERROR',
] as const;
export type FiscalErrorCode = (typeof FISCAL_ERROR_CODES)[number];

export type FiscalErrorCategory =
  | 'VALIDATION'
  | 'CONFIGURATION'
  | 'CLASSIFICATION'
  | 'CALCULATION'
  | 'INTEGRATION'
  | 'UNSUPPORTED'
  | 'INTERNAL';

export interface FiscalError {
  readonly code: FiscalErrorCode;
  readonly message: string;
  readonly step: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;
  readonly category: FiscalErrorCategory;
}

export function fiscalError(input: {
  code: FiscalErrorCode;
  message: string;
  category: FiscalErrorCategory;
  step?: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}): FiscalError {
  const retryable = input.retryable ?? false;
  if (retryable && input.category !== 'INTEGRATION')
    throw new Error('Only INTEGRATION fiscal errors can be retryable');
  return Object.freeze({
    code: input.code,
    message: input.message,
    step: input.step ?? '',
    details: Object.freeze({ ...(input.details ?? {}) }),
    retryable,
    category: input.category,
  });
}
