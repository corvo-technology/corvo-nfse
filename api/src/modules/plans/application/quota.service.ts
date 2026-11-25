import { Injectable } from '@nestjs/common';
import { TenantPlanService } from './tenant-plan.service';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';
import { IPlanRepository } from '../domain/plan.repository';

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
  /** Avulso (bought or bonus) notes; they pay once the plan allowance is spent. */
  avulsoBalance: number;
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
    private readonly planRepo: IPlanRepository,
  ) {}

  async getStatus(tenantId: string): Promise<QuotaStatus> {
    // Ensure period is fresh (lazy renewal)
    const assignment = await this.tenantPlanService.ensurePeriodFresh(tenantId);
    const usage = await this.billingUsage.status(tenantId);
    const activeCompanies =
      await this.companyRepo.countActiveByTenantId(tenantId);

    const dailyUsage = usage.dailyUsage;
    // Same rule as BillingUsageService.reserve: an exhausted plan allowance is covered by avulso notes.
    const planExhausted =
      usage.period.authorized + usage.period.reserved >= usage.hard_limit;
    // A lapsed plan with avulso notes still emits (only the avulso pays); without them it stays blocked.
    const hasAvulso = usage.avulsoBalance > 0;
    const reason = usage.blocked
      ? hasAvulso
        ? undefined
        : QuotaExceededReason.PLAN_BLOCKED
      : planExhausted && !hasAvulso
        ? QuotaExceededReason.NO_CREDITS
        : undefined;
    const dailyExceeded =
      assignment.plan.dailyLimit !== null &&
      dailyUsage >= assignment.plan.dailyLimit;
    const finalReason =
      reason ?? (dailyExceeded ? QuotaExceededReason.DAILY_LIMIT : undefined);
    // A lapsed plan never grants more companies than the free plan; existing ones stay usable.
    let maxActiveCompanies = assignment.plan.maxActiveCompanies;
    if (usage.blocked && hasAvulso) {
      const free = await this.planRepo.findBySlug('free');
      if (free)
        maxActiveCompanies = Math.min(
          maxActiveCompanies,
          free.maxActiveCompanies,
        );
    }
    return {
      canEmit: !finalReason,
      reason: finalReason,
      creditsRemaining: usage.included_remaining,
      avulsoBalance: usage.avulsoBalance,
      creditsUsed: usage.period.authorized,
      creditsReserved: usage.period.reserved,
      monthlyAllowance: usage.period.included,
      dailyUsage,
      dailyLimit: assignment.plan.dailyLimit,
      activeCompanies,
      maxActiveCompanies,
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
    if (
      status.maxActiveCompanies < 999999 &&
      status.activeCompanies >= status.maxActiveCompanies
    ) {
      throw new QuotaExceededError(QuotaExceededReason.COMPANY_LIMIT, {
        active: status.activeCompanies,
        max: status.maxActiveCompanies,
      });
    }
  }

  // Fiscal reservations and settlement are owned by InvoiceLifecycleService.
}
