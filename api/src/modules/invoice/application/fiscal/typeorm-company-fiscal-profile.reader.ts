import { Injectable } from '@nestjs/common';
import {
  isEffectiveOn,
  type CompanyFiscalProfile,
} from '@/modules/company/domain/fiscal-profile';
import { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
import type { IFiscalProfileReader } from '@/modules/invoice/domain/fiscal/ports/fiscal-profile.reader';

/**
 * Adapter that answers the fiscal engine's port question ("which company
 * fiscal profiles are effective on this date?") through the TypeORM-backed
 * company service. Effective-date resolution is delegated to the domain
 * helper `isEffectiveOn` so the engine and the API share one window rule
 * (validFrom inclusive, validUntil exclusive).
 */
@Injectable()
export class TypeOrmCompanyFiscalProfileReader implements IFiscalProfileReader {
  constructor(private readonly profiles: CompanyFiscalProfileService) {}

  async findEffectiveByDate(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyFiscalProfile[]> {
    const all = await this.profiles.list(companyId, tenantId);
    return all.filter((profile) => isEffectiveOn(profile, date));
  }
}
