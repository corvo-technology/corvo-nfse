import { data } from '@/shared/http/response';
import {
  Controller,
  HttpCode,
  Get,
  Post,
  Body,
  Req,
  NotFoundException,
  BadRequestException,
  Headers,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { QuotaService } from '@/modules/plans/application/quota.service';
import type { QuotaStatus } from '@/modules/plans/application/quota.service';
import { BillingService } from './application/billing.service';
import { CheckoutRouterService } from './application/checkout-router.service';
import { WooviPaymentsService } from './application/woovi-payments.service';
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
    private readonly checkoutRouter: CheckoutRouterService,
    private readonly pix: WooviPaymentsService,
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
        monthly_price_cents: this.pricingService.calculateQuote(
          plan.slug,
          'monthly',
        ).monthlyEquivalentCents,
      },
      subscription: {
        status: billing.billing?.stripeStatus ?? 'none',
        paid_until: billing.billing?.paidUntil?.toISOString() ?? null,
        cancel_at_period_end: billing.billing?.cancelAtPeriodEnd ?? false,
        scheduled_plan: billing.billing?.pendingPlanSlug ?? null,
        blocked: billing.blocked,
        pix_subscription: await this.pix.hasPixSubscription(tenantId),
      },
      usage: {
        hard_limit: billing.hard_limit,
        avulso_balance: billing.avulsoBalance,
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
    const tenantId = req.authContext!.activeTenantId;
    const method = body.method ?? 'card';
    if ((body.kind ?? 'plan') === 'avulso') {
      if (body.units === undefined)
        throw new BadRequestException('units is required for avulso');
      return data(
        await this.checkoutRouter.start(
          tenantId,
          { kind: 'avulso', units: body.units, method },
          key,
        ),
      );
    }
    if (!body.plan_slug)
      throw new BadRequestException('plan_slug is required for a plan');
    return data(
      await this.checkoutRouter.start(
        tenantId,
        {
          kind: 'plan',
          planSlug: body.plan_slug,
          cycle: body.cycle ?? 'monthly',
          method,
          customer: body.customer,
        },
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

  @Post('pix/cancel')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  async cancelPix(@Req() req: RequestWithAuthContext) {
    await this.pix.cancelPixSubscription(req.authContext!.activeTenantId);
    return data({ cancelled: true });
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
