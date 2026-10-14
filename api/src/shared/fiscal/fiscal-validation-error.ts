export type FiscalIssueCode =
  | 'required'
  | 'blank'
  | 'too_long'
  | 'too_short'
  | 'invalid_cnpj'
  | 'invalid_cpf'
  | 'invalid_tax_id'
  | 'invalid_cep'
  | 'invalid_ibge_code'
  | 'invalid_uf'
  | 'invalid_service_code'
  | 'invalid_email'
  | 'invalid_decimal_places'
  | 'out_of_range'
  | 'future_date'
  | 'schedule_horizon_exceeded'
  | 'invalid_date'
  | 'incomplete_address'
  | 'invalid_type'
  | 'invalid_option'
  | 'invalid_uuid'
  | 'unknown_field'
  | 'invalid';

export interface FiscalIssue {
  field: string;
  code: FiscalIssueCode;
  message: string;
}

export class FiscalValidationError extends Error {
  constructor(readonly issues: FiscalIssue[]) {
    super(issues.map((i) => `${i.field}: ${i.message}`).join('; '));
    this.name = 'FiscalValidationError';
  }
}
