import type { CompanyServiceTaxProfile } from '@/modules/company/domain/service-tax-profile';

export abstract class IServiceProfileReader {
  abstract findById(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<CompanyServiceTaxProfile | null>;
  abstract findEffectiveByCode(
    companyId: string,
    tenantId: string,
    serviceCode: string,
    date: string,
  ): Promise<CompanyServiceTaxProfile[]>;
}
