export class FreeAbuseDetectedError extends Error {
  constructor(
    public readonly code:
      | 'email_already_free'
      | 'tax_id_already_free'
      | 'captcha_invalid'
      | 'turnstile_invalid',
    public readonly details: unknown,
  ) {
    super(`Free plan abuse detected: ${code}`);
    this.name = 'FreeAbuseDetectedError';
  }
}
