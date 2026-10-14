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
    return this.profiles.markApproved(profileId, tenantId, reviewedBy, new Date());
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
}
