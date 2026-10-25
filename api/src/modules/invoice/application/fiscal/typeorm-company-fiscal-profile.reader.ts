import { Injectable, Optional } from '@nestjs/common';
import { SimplesRateService } from '@/modules/company/application/simples-rate.service';
import {
  effectiveProfilesOn,
  type CompanyFiscalProfile,
} from '@/modules/company/domain/fiscal-profile';
import { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
import type { IFiscalProfileReader } from '@/modules/invoice/domain/fiscal/ports/fiscal-profile.reader';

/**
 * Adapter that answers the fiscal engine's port question ("which company
 * fiscal profiles are effective on this date?") through the TypeORM-backed
 * company service. Effective-date resolution is delegated to the domain
 * helper `effectiveProfilesOn` so the engine and the API share one rule
 * (validFrom inclusive, validUntil exclusive, the first profile also applies
 * backwards).
 */
@Injectable()
export class TypeOrmCompanyFiscalProfileReader implements IFiscalProfileReader {
  constructor(
    private readonly profiles: CompanyFiscalProfileService,
    // Optional so the reader keeps working where the rates are not provided.
    @Optional() private readonly simplesRates?: SimplesRateService,
  ) {}

  async findEffectiveByDate(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyFiscalProfile[]> {
    const all = await this.profiles.list(companyId, tenantId);
    const effective = effectiveProfilesOn(all, date);
    if (
      !this.simplesRates ||
      !effective.some((profile) => profile.taxRegime === 'SIMPLES_NACIONAL')
    )
      return effective;
    // The ISS rate informed for the month wins over the one on the profile
    // (LC 123/2006, art. 21, §4º, I: the rate of the previous month's bracket).
    const { rate } = await this.simplesRates.resolve(companyId, tenantId, date);
    if (rate?.issRate == null) return effective;
    const issRate = rate.issRate;
    return effective.map((profile) =>
      profile.taxRegime === 'SIMPLES_NACIONAL'
        ? { ...profile, simplesIssRate: issRate }
        : profile,
    );
  }
}
