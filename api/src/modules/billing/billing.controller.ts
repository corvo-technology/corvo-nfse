import { data } from '@/shared/http/response';
import {
  Controller,
  HttpCode,
  Get,
  Post,
  Body,
  Req,
  NotFoundException,
  Headers,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { QuotaService } from '@/modules/plans/application/quota.service';
import type { QuotaStatus } from '@/modules/plans/application/quota.service';
import { BillingService } from './application/billing.service';
import { BillingUsageService } from './application/billing-usage.service';
import {
  CheckoutDto,
  ChangePlanDto,
  CheckoutSessionParams,
} from './http/billing.dto';
import { PricingService } from '@/modules/plans/application/pricing.service';
import { IPlanRepository } from '@/modules/plans/domain/plan.repository';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly quotaService: QuotaService,
    private readonly billing: BillingService,
    private readonly billingUsage: BillingUsageService,
    private readonly pricingService: PricingService,
    private readonly planRepo: IPlanRepository,
  ) {}

  @Get('plan')
  @ApiKeyEndpoint()
  @RequirePermission('billing.view')
  async getCurrentPlan(
    @Req() req: RequestWithAuthContext,
  ): Promise<{ data: Record<string, unknown> }> {
    const tenantId = req.authContext!.activeTenantId;
    const status = await this.quotaService.getStatus(tenantId);
    const plan = await this.planRepo.findActiveByTenantId(tenantId);
    const billing = await this.billingUsage.status(tenantId);
    if (!plan) throw new NotFoundException('No plan assigned');

    return data({
      plan: {
        slug: plan.slug,
        name: plan.name,
        monthly_allowance: plan.monthlyCreditAllowance,
        daily_limit: plan.dailyLimit,
        max_active_companies: plan.maxActiveCompanies,
        monthly_price_cents: this.pricingService.calculateQuote(plan.slug, 'monthly')
          .monthlyEquivalentCents,
      },
      subscription: {
        status: billing.billing?.stripeStatus ?? 'none',
        paid_until: billing.billing?.paidUntil?.toISOString() ?? null,
        cancel_at_period_end: billing.billing?.cancelAtPeriodEnd ?? false,
        scheduled_plan: billing.billing?.pendingPlanSlug ?? null,
        blocked: billing.blocked,
      },
      usage: {
        overage_units: billing.overage_units,
        overage_amount_cents: billing.overage_amount_cents,
        hard_limit: billing.hard_limit,
        credits_used: status.creditsUsed,
        credits_reserved: status.creditsReserved,
        credits_remaining: status.creditsRemaining,
        monthly_allowance: status.monthlyAllowance,
        daily_usage: status.dailyUsage,
        daily_limit: status.dailyLimit,
        active_companies: status.activeCompanies,
        max_active_companies: status.maxActiveCompanies,
        period_start: status.periodStart?.toISOString(),
        period_end: status.periodEnd?.toISOString(),
      },
    });
  }

  @Get('usage')
  @ApiKeyEndpoint()
  @RequirePermission('billing.view')
  async getUsage(
    @Req() req: RequestWithAuthContext,
  ): Promise<{ data: QuotaStatus }> {
    const tenantId = req.authContext!.activeTenantId;
    return data(await this.quotaService.getStatus(tenantId));
  }

  @Post(['checkout', 'subscribe'])
  @RequirePermission('billing.manage')
  async checkout(
    @Body() body: CheckoutDto,
    @Req() req: RequestWithAuthContext,
    @Headers('idempotency-key') key: string,
  ) {
    return data(
      await this.billing.checkout(
        req.authContext!.activeTenantId,
        body.plan_slug,
        key,
      ),
    );
  }

  @Get('checkout/:sessionId')
  @RequirePermission('billing.view')
  async checkoutStatus(
    @Param() params: CheckoutSessionParams,
    @Req() req: RequestWithAuthContext,
  ) {
    return data(
      await this.billing.checkoutStatus(
        req.authContext!.activeTenantId,
        params.sessionId,
      ),
    );
  }

  @Post('portal')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  async portal(@Req() req: RequestWithAuthContext) {
    return data(await this.billing.portal(req.authContext!.activeTenantId));
  }

  @Post('upgrade')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  async upgrade(
    @Body() body: ChangePlanDto,
    @Req() req: RequestWithAuthContext,
  ) {
    return data(
      await this.billing.changePlan(
        req.authContext!.activeTenantId,
        body.plan_slug,
      ),
    );
  }

  @Post('downgrade')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  async downgrade(
    @Body() body: ChangePlanDto,
    @Req() req: RequestWithAuthContext,
  ) {
    return data(
      await this.billing.changePlan(
        req.authContext!.activeTenantId,
        body.plan_slug,
      ),
    );
  }
}
