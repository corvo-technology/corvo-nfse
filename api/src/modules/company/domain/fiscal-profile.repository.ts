import type {
  CompanyFiscalProfile,
  ProfileReviewStatus,
  SimplesApuracao,
  TaxRegimeKind,
} from './fiscal-profile';

export interface NewFiscalProfile {
  taxRegime: TaxRegimeKind;
  simpleNational: boolean;
  specialTaxRegime: string | null;
  ibsCbsRegularOption: boolean;
  ibsCbsRegularFrom: string | null;
  simplesIssRate: string | null;
  simplesApuracao?: SimplesApuracao | null;
  validFrom: string; // YYYY-MM-DD, inclusive
  source: string;
  reviewStatus: ProfileReviewStatus;
  reviewedBy: string | null;
}

export abstract class IFiscalProfileRepository {
  abstract findEffective(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyFiscalProfile | null>;
  abstract findOpen(
    companyId: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile | null>;
  /** Open (valid_until IS NULL) profiles for a batch of companies. */
  abstract findOpenByCompanyIds(
    companyIds: string[],
    tenantId: string,
  ): Promise<CompanyFiscalProfile[]>;
  /** All profiles of the company, validFrom DESC. */
  abstract list(
    companyId: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile[]>;
  abstract append(
    companyId: string,
    tenantId: string,
    input: NewFiscalProfile,
  ): Promise<CompanyFiscalProfile>;
  abstract findById(
    id: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile | null>;
  abstract markApproved(
    id: string,
    tenantId: string,
    reviewedBy: string,
    at: Date,
  ): Promise<CompanyFiscalProfile>;
}
