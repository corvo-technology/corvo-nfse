export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Company not found: ${companyId}`);
    this.name = 'CompanyNotFoundError';
  }
}

export class CompanyNotReadyError extends Error {
  constructor(companyId: string, missing: string[]) {
    super(`Company ${companyId} is not ready. Missing: ${missing.join(', ')}`);
    this.name = 'CompanyNotReadyError';
  }
}

export class CompanyBlockedError extends Error {
  constructor(companyId: string) {
    super(`Company ${companyId} is blocked`);
    this.name = 'CompanyBlockedError';
  }
}

export class CompanyAlreadyExistsError extends Error {
  constructor(taxId: string) {
    super(`A company with tax ID ${taxId} already exists`);
    this.name = 'CompanyAlreadyExistsError';
  }
}

export class TaxRegimeNotSupportedError extends Error {
  constructor(regime: string) {
    super(`Tax regime not supported: ${regime}`);
    this.name = 'TaxRegimeNotSupportedError';
  }
}
