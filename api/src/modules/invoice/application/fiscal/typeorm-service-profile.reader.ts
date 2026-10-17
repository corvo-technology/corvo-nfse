import { Injectable } from '@nestjs/common';
import { CompanyServiceTaxProfileService } from '@/modules/company/application/company-service-tax-profile.service';
import type { CompanyServiceTaxProfile } from '@/modules/company/domain/service-tax-profile';
import type { IServiceProfileReader } from '@/modules/invoice/domain/fiscal/ports/service-profile.reader';

/**
 * Adapter from the fiscal engine's service-profile port to the TypeORM-backed
 * company service. `findEffectiveByCode` lists the profiles already filtered
 * by the validity window and narrows them to the invoiced service code —
 * ambiguity (zero, one or many candidates) is decided by the fiscal engine,
 * never here.
 */
@Injectable()
export class TypeOrmServiceProfileReader implements IServiceProfileReader {
  constructor(private readonly profiles: CompanyServiceTaxProfileService) {}

  findById(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<CompanyServiceTaxProfile | null> {
    return this.profiles.findById(id, companyId, tenantId);
  }

  async findEffectiveByCode(
    companyId: string,
    tenantId: string,
    serviceCode: string,
    date: string,
  ): Promise<CompanyServiceTaxProfile[]> {
    const effective = await this.profiles.list(companyId, tenantId, date);
    return effective.filter((profile) => profile.serviceCode === serviceCode);
  }
}
