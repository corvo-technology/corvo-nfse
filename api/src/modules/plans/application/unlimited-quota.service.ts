import { Injectable } from '@nestjs/common';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';
import { QuotaService, QuotaStatus } from './quota.service';

/** Same "no limit" sentinel the recurring plans use for companies. */
const UNLIMITED = 999999;

/**
 * Quota for `self_hosted`: there is no plan to run out of. Nothing is metered, so emission and
 * company creation are never refused. Only the company count is real, for display.
 */
@Injectable()
export class UnlimitedQuotaService extends QuotaService {
  constructor(private readonly companies: ICompanyRepository) {
    super(null as never, null as never, companies);
  }

  override async getStatus(tenantId: string): Promise<QuotaStatus> {
    return {
      canEmit: true,
      creditsRemaining: UNLIMITED,
      creditsUsed: 0,
      creditsReserved: 0,
      monthlyAllowance: UNLIMITED,
      dailyUsage: 0,
      dailyLimit: null,
      activeCompanies: await this.companies.countActiveByTenantId(tenantId),
      maxActiveCompanies: UNLIMITED,
      periodStart: null,
      periodEnd: null,
    };
  }

  override async assertCanEmit(): Promise<void> {}

  override async assertCanCreateCompany(): Promise<void> {}
}
