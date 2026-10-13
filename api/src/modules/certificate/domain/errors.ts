export class CertificateNotFoundError extends Error {
  constructor(certId: string) {
    super(`Certificate not found: ${certId}`);
    this.name = 'CertificateNotFoundError';
  }
}

export class CertificateInvalidError extends Error {
  constructor(reason: string) {
    super(`Certificate is invalid: ${reason}`);
    this.name = 'CertificateInvalidError';
  }
}

export class CertificateExpiredError extends Error {
  public readonly validUntil: Date;

  constructor(validUntil: Date) {
    super(`Certificate expired on ${validUntil.toISOString()}`);
    this.name = 'CertificateExpiredError';
    this.validUntil = validUntil;
  }
}

export class CertificateTaxIdMismatchError extends Error {
  constructor() {
    super('Certificate CNPJ does not match company tax ID');
    this.name = 'CertificateTaxIdMismatchError';
  }
}
