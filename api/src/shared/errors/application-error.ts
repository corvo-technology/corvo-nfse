export type ApplicationErrorKind =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'dependency'
  | 'internal';

export type SafeErrorDetail = string | number | boolean | null;

export type ApplicationErrorOptions = {
  code: string;
  kind: ApplicationErrorKind;
  safeMessage: string;
  message?: string;
  safeDetails?: Readonly<Record<string, SafeErrorDetail>>;
  retryable?: boolean;
  cause?: unknown;
};

/**
 * Transport-agnostic error contract for failures that cross an application
 * boundary. HTTP, queue and CLI adapters decide how each kind is presented.
 */
export class ApplicationError extends Error {
  readonly code: string;
  readonly kind: ApplicationErrorKind;
  readonly safeMessage: string;
  readonly safeDetails?: Readonly<Record<string, SafeErrorDetail>>;
  readonly retryable: boolean;

  constructor(options: ApplicationErrorOptions) {
    super(options.message ?? options.safeMessage, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.kind = options.kind;
    this.safeMessage = options.safeMessage;
    this.safeDetails = options.safeDetails;
    this.retryable = options.retryable ?? false;
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
