import { data } from '@/shared/http/response';
import { EntityNotFoundError } from 'typeorm';
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
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { QuotaService } from '@/modules/plans/application/quota.service';
import type { QuotaStatus } from '@/modules/plans/application/quota.service';
import { BillingService } from './application/billing.service';
import { CheckoutRouterService } from './application/checkout-router.service';
import { WooviPaymentsService } from './application/woovi-payments.service';
import { PaymentHistoryService } from './application/payment-history.service';
import { BillingUsageService } from './application/billing-usage.service';
import {
  CheckoutDto,
  ChangePlanDto,
  CheckoutSessionParams,
  PaymentStatusParams,
} from './http/billing.dto';
import { PricingService } from '@/modules/plans/application/pricing.service';
import { IPlanRepository } from '@/modules/plans/domain/plan.repository';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);
  constructor(
    private readonly quotaService: QuotaService,
    private readonly billing: BillingService,
    private readonly billingUsage: BillingUsageService,
    private readonly pricingService: PricingService,
    private readonly planRepo: IPlanRepository,
    private readonly checkoutRouter: CheckoutRouterService,
    private readonly pix: WooviPaymentsService,
    private readonly paymentHistory: PaymentHistoryService,
  ) {}

  @Get('plan')
  @ApiKeyEndpoint()
  @RequirePermission('billing.view')
  async getCurrentPlan(
    @Req() req: RequestWithAuthContext,
  ): Promise<{ data: Record<string, unknown> }> {
    const tenantId = req.authContext!.activeTenantId;
    const { status, plan, billing } = await this.loadPlanState(tenantId);
    if (!plan)
      throw new NotFoundException({
        code: 'NO_PLAN_ASSIGNED',
        message: 'No plan assigned',
      });

    return data({
      plan: {
        slug: plan.slug,
        name: plan.name,
        monthly_allowance: plan.monthlyCreditAllowance,
        daily_limit: plan.dailyLimit,
        max_active_companies: plan.maxActiveCompanies,
        monthly_price_cents: this.pricingService.monthlyPriceCents(plan.slug),
      },
      subscription: {
        status: billing.billing?.stripeStatus ?? 'none',
        paid_until: billing.billing?.paidUntil?.toISOString() ?? null,
        cancel_at_period_end: billing.billing?.cancelAtPeriodEnd ?? false,
        scheduled_plan: billing.billing?.pendingPlanSlug ?? null,
        blocked: billing.blocked,
        // The Stripe portal needs a Stripe customer: accounts that only paid by Pix have none.
        stripe_portal_available: !!billing.billing?.stripeCustomerId,
        // Plan changes (upgrade/downgrade) are Stripe subscription changes: only with a live subscription.
        stripe_subscription: !!billing.billing?.stripeSubscriptionId,
        pix_subscription: await this.pix.pixSubscriptionState(tenantId),
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

  /**
   * The tenant row must always be readable for its own session. When it is not (a connection whose
   * tenant setting did not apply), retry once on a fresh connection and log it, so the page does not
   * break on a transient miss but the event stays visible.
   */
  private async loadPlanState(tenantId: string) {
    const load = async () => {
      const status = await this.quotaService.getStatus(tenantId);
      const plan = await this.planRepo.findActiveByTenantId(tenantId);
      const billing = await this.billingUsage.status(tenantId);
      return { status, plan, billing };
    };
    try {
      return await load();
    } catch (error) {
      if (!(error instanceof EntityNotFoundError)) throw error;
      this.logger.warn({
        event: 'tenant_scope_miss_retry',
        msg: 'Tenant row not visible on first read; retrying once',
        tenantId,
      });
      return load();
    }
  }

  @Get('payments')
  @RequirePermission('billing.view')
  async payments(@Req() req: RequestWithAuthContext) {
    return data(
      await this.paymentHistory.list(req.authContext!.activeTenantId),
    );
  }

  /** Polled by the Pix screen: tenant-scoped, so another account's payment id answers 404. */
  @Get('payments/:paymentId/status')
  @RequirePermission('billing.view')
  async paymentStatus(
    @Param() params: PaymentStatusParams,
    @Req() req: RequestWithAuthContext,
  ) {
    const status = await this.pix.paymentStatus(
      req.authContext!.activeTenantId,
      params.paymentId,
    );
    if (!status)
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    return data(status);
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
        throw new BadRequestException({
          code: 'CHECKOUT_INVALID',
          message: 'units is required for avulso',
        });
      return data(
        await this.checkoutRouter.start(
          tenantId,
          {
            kind: 'avulso',
            units: body.units,
            method,
            customer: body.customer,
          },
          key,
        ),
      );
    }
    if (!body.plan_slug)
      throw new BadRequestException({
        code: 'CHECKOUT_INVALID',
        message: 'plan_slug is required for a plan',
      });
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
