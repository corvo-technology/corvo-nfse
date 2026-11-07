export const STATUS_ERRORS: Record<number, { code: string; message: string }> =
  {
    400: { code: 'ERROR_BAD_REQUEST', message: 'Invalid request' },
    401: { code: 'ERROR_UNAUTHORIZED', message: 'Authentication required' },
    402: { code: 'ERROR_PAYMENT_REQUIRED', message: 'Payment required' },
    403: { code: 'ERROR_FORBIDDEN', message: 'Access denied' },
    404: { code: 'ERROR_NOT_FOUND', message: 'Resource not found' },
    405: { code: 'ERROR_METHOD_NOT_ALLOWED', message: 'Method not allowed' },
    409: { code: 'ERROR_CONFLICT', message: 'Resource conflict' },
    410: { code: 'ERROR_GONE', message: 'Resource no longer available' },
    413: {
      code: 'ERROR_PAYLOAD_TOO_LARGE',
      message: 'Request payload too large',
    },
    415: {
      code: 'ERROR_UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported media type',
    },
    422: {
      code: 'ERROR_UNPROCESSABLE_ENTITY',
      message: 'Business rule rejected the request',
    },
    429: { code: 'ERROR_RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' },
    500: { code: 'ERROR_INTERNAL', message: 'Internal server error' },
    502: { code: 'ERROR_BAD_GATEWAY', message: 'Upstream service unavailable' },
    503: {
      code: 'ERROR_SERVICE_UNAVAILABLE',
      message: 'Service temporarily unavailable',
    },
    504: {
      code: 'ERROR_GATEWAY_TIMEOUT',
      message: 'Upstream service timed out',
    },
  };
export const DOMAIN_ERRORS: Record<
  string,
  { status: number; code: string; message: string }
> = {
  CompanyNotFoundError: {
    status: 404,
    code: 'ERROR_COMPANY_NOT_FOUND',
    message: 'Company not found',
  },
  CompanyNotReadyError: {
    status: 422,
    code: 'ERROR_COMPANY_NOT_READY',
    message: 'Company setup is incomplete',
  },
  CompanyBlockedError: {
    status: 403,
    code: 'ERROR_COMPANY_BLOCKED',
    message: 'Company is blocked',
  },
  CompanyAlreadyExistsError: {
    status: 409,
    code: 'ERROR_COMPANY_ALREADY_EXISTS',
    message: 'Company already exists',
  },
  InvoiceNotFoundError: {
    status: 404,
    code: 'ERROR_INVOICE_NOT_FOUND',
    message: 'Invoice not found',
  },
  InvalidInvoiceTransitionError: {
    status: 409,
    code: 'ERROR_INVALID_INVOICE_TRANSITION',
    message: 'Invalid invoice transition',
  },
  IdempotencyConflictError: {
    status: 409,
    code: 'ERROR_IDEMPOTENCY_CONFLICT',
    message: 'Idempotency key was used with a different payload',
  },
  InvoiceNotCancellableError: {
    status: 409,
    code: 'ERROR_INVOICE_NOT_CANCELLABLE',
    message: 'Invoice cannot be cancelled in its current status',
  },
  ConcurrentInvoiceTransitionError: {
    status: 409,
    code: 'ERROR_CONCURRENT_INVOICE_TRANSITION',
    message: 'Invoice changed while the request was processed; retry',
  },
  InvalidCancellationReasonError: {
    status: 422,
    code: 'ERROR_INVALID_CANCELLATION_REASON',
    message: 'Cancellation description must have 15 to 255 characters',
  },
  CertificateNotFoundError: {
    status: 404,
    code: 'ERROR_CERTIFICATE_NOT_FOUND',
    message: 'Certificate not found',
  },
  CertificateInvalidError: {
    status: 422,
    code: 'ERROR_CERTIFICATE_INVALID',
    message: 'Certificate is invalid',
  },
  CertificateExpiredError: {
    status: 422,
    code: 'ERROR_CERTIFICATE_EXPIRED',
    message: 'Certificate has expired',
  },
  CertificateTaxIdMismatchError: {
    status: 422,
    code: 'ERROR_CERTIFICATE_TAX_ID_MISMATCH',
    message: 'Certificate tax ID does not match the company',
  },
  TenantMembershipNotFoundError: {
    status: 401,
    code: 'ERROR_MEMBERSHIP_NOT_FOUND',
    message: 'Tenant membership not found',
  },
  TenantMembershipInactiveError: {
    status: 403,
    code: 'ERROR_MEMBERSHIP_INACTIVE',
    message: 'Tenant membership is inactive',
  },
  TenantAccessDeniedError: {
    status: 403,
    code: 'ERROR_TENANT_ACCESS_DENIED',
    message: 'Tenant access denied',
  },
  TenantPermissionDeniedError: {
    status: 403,
    code: 'ERROR_PERMISSION_DENIED',
    message: 'Required permission is missing',
  },
  UnknownTenantPermissionError: {
    status: 400,
    code: 'ERROR_UNKNOWN_PERMISSION',
    message: 'Unknown permission',
  },
  AuthUserEmailAlreadyExistsError: {
    status: 409,
    code: 'ERROR_EMAIL_ALREADY_EXISTS',
    message: 'Email already exists',
  },
  LastTenantAdminError: {
    status: 409,
    code: 'ERROR_LAST_TENANT_ADMIN',
    message: 'Cannot remove the last active tenant admin',
  },
  DuplicatePendingInvitationError: {
    status: 409,
    code: 'ERROR_DUPLICATE_INVITATION',
    message: 'A pending invitation already exists',
  },
  InsufficientCreditsError: {
    status: 402,
    code: 'ERROR_INSUFFICIENT_CREDITS',
    message: 'Insufficient credits',
  },
  FreeAbuseDetectedError: {
    status: 403,
    code: 'ERROR_FREE_PLAN_ABUSE',
    message: 'Free plan eligibility check failed',
  },
  TaxRegimeNotSupportedError: {
    status: 422,
    code: 'ERROR_TAX_REGIME_NOT_SUPPORTED',
    message: 'Only MEI and Simples Nacional companies are supported',
  },
  ScheduleNotFoundError: {
    status: 404,
    code: 'ERROR_SCHEDULE_NOT_FOUND',
    message: 'Schedule not found',
  },
  ScheduleLimitError: {
    status: 422,
    code: 'ERROR_SCHEDULE_LIMIT',
    message: 'Active schedule limit reached',
  },
  ScheduleStateError: {
    status: 409,
    code: 'ERROR_SCHEDULE_STATE',
    message: 'The schedule is not in a state that allows this',
  },
  ImportNotFoundError: {
    status: 404,
    code: 'ERROR_IMPORT_NOT_FOUND',
    message: 'Import not found',
  },
  ImportStateError: {
    status: 409,
    code: 'ERROR_IMPORT_STATE',
    message: 'The import is not in a state that allows this',
  },
  ImportFileInvalidError: {
    status: 400,
    code: 'ERROR_IMPORT_FILE_INVALID',
    message: 'Send a .csv or .xlsx file',
  },
  ImportFileTooLargeError: {
    status: 413,
    code: 'ERROR_IMPORT_FILE_TOO_LARGE',
    message: 'The file is larger than 10 MB',
  },
  QuotaExceededError: {
    status: 422,
    code: 'ERROR_QUOTA_EXCEEDED',
    message: 'Plan quota exceeded',
  },
};
export function publicErrorCode(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^(?:ERROR_)?[A-Z][A-Z0-9_]*$/i.test(value))
    return fallback;
  const code = value.toUpperCase();
  if (code === 'VALIDATION_ERROR') return 'ERROR_VALIDATION';
  return code.startsWith('ERROR_') ? code : `ERROR_${code}`;
}
export function apiErrorBody(
  statusCode: number,
  input: unknown,
  requestId: string,
) {
  const defaults = STATUS_ERRORS[statusCode] ?? {
    code: `ERROR_HTTP_${statusCode}`,
    message: 'Request failed',
  };
  const body =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const code = publicErrorCode(body.code ?? body.reason, defaults.code);
  const message =
    statusCode >= 500
      ? defaults.message
      : typeof body.message === 'string'
        ? body.message
        : typeof input === 'string'
          ? input
          : defaults.message;
  let details: unknown;
  if (statusCode < 500 && Array.isArray(body.details)) {
    details = body.details
      .filter((item: unknown) => item && typeof item === 'object')
      .map((item: Record<string, unknown>) => ({
        ...(typeof item.field === 'string' ? { field: item.field } : {}),
        code: publicErrorCode(item.code, 'ERROR_INVALID'),
        message:
          typeof item.message === 'string' ? item.message : 'Invalid value',
      }));
  } else if (
    body.details &&
    typeof body.details === 'object' &&
    statusCode < 500
  ) {
    details = body.details;
  }
  return {
    statusCode,
    code,
    message,
    ...(details ? { details } : {}),
    requestId,
  };
}
