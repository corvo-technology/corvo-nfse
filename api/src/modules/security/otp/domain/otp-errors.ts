export class OtpIssueCooldownError extends Error {
  readonly code = 'OTP_ISSUE_COOLDOWN';
  readonly statusCode = 429;
  constructor(
    public readonly channel: string,
    public readonly target: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(
      `OTP issue cooldown active for ${channel} ${target}. Retry after ${retryAfterSeconds}s`,
    );
    this.name = 'OtpIssueCooldownError';
  }
}

export class OtpIssueRateLimitError extends Error {
  readonly code = 'OTP_ISSUE_RATE_LIMIT';
  readonly statusCode = 429;
  constructor(
    public readonly scope: 'channel' | 'subject' | 'ip',
    public readonly retryAfterSeconds: number,
  ) {
    super(
      `OTP issue rate limit exceeded for ${scope}. Retry after ${retryAfterSeconds}s`,
    );
    this.name = 'OtpIssueRateLimitError';
  }
}

export class OtpVerificationFailedError extends Error {
  readonly code = 'OTP_VERIFICATION_FAILED';
  readonly statusCode = 400;
  constructor() {
    super('Invalid or expired verification code');
    this.name = 'OtpVerificationFailedError';
  }
}

export class OtpDeliveryUnavailableError extends Error {
  readonly code = 'OTP_DELIVERY_UNAVAILABLE';
  readonly statusCode = 503;
  constructor(public readonly channel: string) {
    super(`OTP delivery is unavailable for ${channel}`);
    this.name = 'OtpDeliveryUnavailableError';
  }
}

export class InvalidOtpTargetError extends Error {
  readonly code = 'OTP_TARGET_INVALID';
  readonly statusCode = 400;
  constructor(public readonly channel: string) {
    super(`Invalid OTP target for ${channel}`);
    this.name = 'InvalidOtpTargetError';
  }
}
