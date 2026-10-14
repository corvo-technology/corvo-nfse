import type { ProfileReviewStatus, TaxRegimeKind } from './fiscal-profile';

export type OperationNature = 'SERVICE' | 'GOODS' | 'MIXED' | 'PARTNER_SALON';
export type IssTaxation = 'NORMAL' | 'FIXED' | 'EXEMPT';
export type WithholdingPolicy = 'UNKNOWN' | 'NONE_CONFIRMED' | 'CONFIGURED';

/** Percent strings, e.g. "1.5". */
export interface WithholdingRates {
  irrf?: string;
  pis?: string;
  cofins?: string;
  csll?: string;
  inss?: string;
}

export interface CompanyServiceTaxProfile {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  serviceCode: string;
  municipalServiceCode: string | null;
  nbsCode: string | null;
  cst: string | null;
  classCode: string | null;
  operationIndicator: string | null;
  operationNature: OperationNature;
  regimeApplicability: TaxRegimeKind[];
  incidenceMunicipalityCode: string | null;
  issTaxation: IssTaxation | null;
  issRate: string | null;
  issWithholdingDefault: boolean;
  withholdingPolicy: WithholdingPolicy;
  withholdingRates: WithholdingRates;
  effectiveFrom: string;
  effectiveUntil: string | null;
  classificationSource: string;
  reviewStatus: ProfileReviewStatus;
  catalogVersion: string | null;
  createdAt: Date;
}
