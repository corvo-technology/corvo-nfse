import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  GoneException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { CreditsService } from '../application/credits.service';
import { IPlanRepository } from '@/modules/plans/domain/plan.repository';

@ApiTags('credits')
@Controller('credits')
export class CreditsController {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly usage: BillingUsageService,
    private readonly planRepo: IPlanRepository,
  ) {}

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('credits.view')
  @ApiOperation({ summary: 'Get current credit balance' })
  async getBalance(@Req() req: RequestWithAuthContext) {
    const tenantId = req.authContext!.activeTenantId;
    const usage = await this.usage.status(tenantId);
    return {
      balance: usage.included_remaining,
      overageUnits: usage.overage_units,
      overageAmountCents: usage.overage_amount_cents,
      hardLimit: usage.hard_limit,
    };
  }

  @Get('plans')
  @ApiKeyEndpoint()
  @RequirePermission('credits.view')
  @ApiOperation({ summary: 'List all plans (free + paid tiers)' })
  @ApiCursorResponse()
  async listPlans(@Query() options: CursorQuery) {
    return this.planRepo.listPage(options);
  }

  @Post('purchase/preview')
  @ApiKeyEndpoint()
  @RequirePermission('credits.view')
  @ApiOperation({
    summary: 'Preview credit conversion for an avulso amount',
  })
  previewPurchase() {
    throw new GoneException(
      'Credit purchases have been replaced by monthly subscriptions and billed overage',
    );
  }

  @Post('purchase/confirm')
  @RequirePermission('credits.manage')
  @ApiOperation({ summary: 'Confirm avulso credit purchase' })
  confirmPurchase() {
    throw new GoneException(
      'Credit purchases have been replaced by monthly subscriptions and billed overage',
    );
  }

  @Get('history')
  @ApiKeyEndpoint()
  @RequirePermission('credits.view')
  @ApiOperation({ summary: 'Get credit transaction history' })
  @ApiCursorResponse()
  async getHistory(
    @Req() req: RequestWithAuthContext,
    @Query() options: CursorQuery,
  ) {
    return this.creditsService.getHistoryPage(
      req.authContext!.activeTenantId,
      options,
    );
  }
}
