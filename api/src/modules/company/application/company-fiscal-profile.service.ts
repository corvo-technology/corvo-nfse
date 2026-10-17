import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CompanyFiscalProfile } from '../domain/fiscal-profile';
import {
  IFiscalProfileRepository,
  type NewFiscalProfile,
} from '../domain/fiscal-profile.repository';

@Injectable()
export class CompanyFiscalProfileService {
  constructor(
    @Inject(IFiscalProfileRepository)
    private readonly profiles: IFiscalProfileRepository,
  ) {}

  record(
    companyId: string,
    tenantId: string,
    input: NewFiscalProfile,
  ): Promise<CompanyFiscalProfile> {
    return this.profiles.append(companyId, tenantId, input);
  }

  async approve(
    companyId: string,
    tenantId: string,
    profileId: string,
    reviewedBy: string,
  ): Promise<CompanyFiscalProfile> {
    const profile = await this.profiles.findById(profileId, tenantId);
    if (!profile || profile.companyId !== companyId)
      throw new NotFoundException('Fiscal profile not found');
    return this.profiles.markApproved(
      profileId,
      tenantId,
      reviewedBy,
      new Date(),
    );
  }

  list(companyId: string, tenantId: string): Promise<CompanyFiscalProfile[]> {
    return this.profiles.list(companyId, tenantId);
  }

  current(
    companyId: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile | null> {
    return this.profiles.findOpen(companyId, tenantId);
  }

  findEffective(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyFiscalProfile | null> {
    return this.profiles.findEffective(companyId, tenantId, date);
  }

  /**
   * Returns a companyId → current (open) profile map for a batch of companies,
   * for list endpoints that must surface the regime of each row.
   */
  async currentByCompanyIds(
    companyIds: string[],
    tenantId: string,
  ): Promise<Map<string, CompanyFiscalProfile>> {
    if (companyIds.length === 0) return new Map();
    const profiles = await this.profiles.findOpenByCompanyIds(
      companyIds,
      tenantId,
    );
    return new Map(profiles.map((profile) => [profile.companyId, profile]));
  }
}
