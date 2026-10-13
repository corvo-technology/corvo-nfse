import { Injectable } from '@nestjs/common';
import { TenantPlanService } from './tenant-plan.service';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';

export enum QuotaExceededReason {
  NO_CREDITS = 'no_credits',
  DAILY_LIMIT = 'daily_limit_exceeded',
  COMPANY_LIMIT = 'company_limit_exceeded',
  PLAN_BLOCKED = 'plan_blocked',
}

export class QuotaExceededError extends Error {
  constructor(
    public readonly reason: QuotaExceededReason,
    public readonly details: Record<string, unknown>,
  ) {
    super(`Quota exceeded: ${reason}`);
    this.name = 'QuotaExceededError';
  }
}

export interface QuotaStatus {
  canEmit: boolean;
  reason?: QuotaExceededReason;
  creditsRemaining: number;
  creditsUsed: number;
  creditsReserved: number;
  monthlyAllowance: number;
  dailyUsage: number;
  dailyLimit: number | null;
  activeCompanies: number;
  maxActiveCompanies: number;
  periodStart: Date | null;
  periodEnd: Date | null;
}

@Injectable()
export class QuotaService {
  constructor(
    private readonly tenantPlanService: TenantPlanService,
    private readonly billingUsage: BillingUsageService,
    private readonly companyRepo: ICompanyRepository,
  ) {}

  async getStatus(tenantId: string): Promise<QuotaStatus> {
    // Ensure period is fresh (lazy renewal)
    const assignment = await this.tenantPlanService.ensurePeriodFresh(tenantId);
    const usage = await this.billingUsage.status(tenantId);
    const activeCompanies =
      await this.companyRepo.countActiveByTenantId(tenantId);

    const dailyUsage = usage.dailyUsage;
    const reason = usage.blocked
      ? QuotaExceededReason.PLAN_BLOCKED
      : usage.period.authorized + usage.period.reserved >= usage.hard_limit
        ? QuotaExceededReason.NO_CREDITS
        : assignment.plan.dailyLimit !== null &&
            dailyUsage >= assignment.plan.dailyLimit
          ? QuotaExceededReason.DAILY_LIMIT
          : undefined;
    return {
      canEmit: !reason,
      reason,
      creditsRemaining: usage.included_remaining,
      creditsUsed: usage.period.authorized,
      creditsReserved: usage.period.reserved,
      monthlyAllowance: usage.period.included,
      dailyUsage,
      dailyLimit: assignment.plan.dailyLimit,
      activeCompanies,
      maxActiveCompanies: assignment.plan.maxActiveCompanies,
      periodStart: usage.period.periodStart,
      periodEnd: usage.period.periodEnd,
    };
  }

  async assertCanEmit(tenantId: string): Promise<void> {
    const status = await this.getStatus(tenantId);

    if (status.reason)
      throw new QuotaExceededError(status.reason, {
        remaining: status.creditsRemaining,
        dailyUsage: status.dailyUsage,
        dailyLimit: status.dailyLimit,
      });
  }

  async assertCanCreateCompany(tenantId: string): Promise<void> {
    const status = await this.getStatus(tenantId);
    if (status.activeCompanies >= status.maxActiveCompanies) {
      throw new QuotaExceededError(QuotaExceededReason.COMPANY_LIMIT, {
        active: status.activeCompanies,
        max: status.maxActiveCompanies,
      });
    }
  }

  // Fiscal reservations and settlement are owned by InvoiceLifecycleService.
}
