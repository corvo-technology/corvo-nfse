import type { CompanyServiceTaxProfile } from './service-tax-profile';

/** A service tax profile without its persistence-owned fields. */
export type NewServiceTaxProfile = Omit<
  CompanyServiceTaxProfile,
  'id' | 'tenantId' | 'companyId' | 'createdAt'
>;

export abstract class IServiceTaxProfileRepository {
  /**
   * All rows for the service code whose validity window contains `date`
   * (effectiveFrom inclusive, effectiveUntil exclusive). Zero, one or many
   * candidates: ambiguity is decided by the fiscal engine, never here.
   */
  abstract findEffectiveByCompanyAndCode(
    companyId: string,
    tenantId: string,
    serviceCode: string,
    date: string,
  ): Promise<CompanyServiceTaxProfile[]>;
  /** All rows of the company whose validity window contains `date`. */
  abstract findEffectiveByCompany(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyServiceTaxProfile[]>;
  abstract findById(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<CompanyServiceTaxProfile | null>;
  /** Inserts when `id` is null; overwrites the row identified by `id` otherwise. */
  abstract upsert(
    id: string | null,
    companyId: string,
    tenantId: string,
    input: NewServiceTaxProfile,
  ): Promise<CompanyServiceTaxProfile>;
  /** Approves only the review status, preserving the saved classification. */
  abstract markApproved(id: string, companyId: string, tenantId: string): Promise<CompanyServiceTaxProfile>;
  abstract delete(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<void>;
}
