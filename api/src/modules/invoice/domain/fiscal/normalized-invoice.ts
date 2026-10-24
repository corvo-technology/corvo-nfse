import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { DecimalString } from './money';

export interface ServiceFiscalInput {
  nbsCode?: string;
  cst?: string;
  classCode?: string;
  operationIndicator?: string;
}

export interface FiscalCustomer {
  kind: 'CPF' | 'CNPJ';
  taxId: string;
  municipalityCode: string | null;
}

export interface NormalizedInvoice {
  invoiceId: string;
  tenantId: string;
  environment: ExecutionEnvironment;
  company: {
    id: string;
    taxId: string;
    municipalityCode: string;
    municipalRegistration: string | null;
  };
  /** Fato gerador, YYYY-MM-DD. */
  competenceDate: string;
  grossAmount: DecimalString;
  discountAmount: DecimalString;
  /**
   * Issuer-declared deduction from the ISS base (DPS `vDedRed/vDR`). Absent
   * means 0.00.
   */
  deductionAmount?: DecimalString;
  service: {
    code: string;
    municipalityCode: string;
    description: string | null;
    fiscal: ServiceFiscalInput | null;
    serviceProfileId: string | null;
  };
  customer: FiscalCustomer | null;
}
