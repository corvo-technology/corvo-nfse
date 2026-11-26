export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

/** Facts about the issuer that validators may check against; no tax is calculated here. */
export interface CompanyFiscalSnapshot {
  cnpj: string;
  uf: string;
  crt: number | null;
  stateRegistration: string | null;
}

export interface TaxValidator<D> {
  validate(doc: D, profile: CompanyFiscalSnapshot): ValidationIssue[];
}
