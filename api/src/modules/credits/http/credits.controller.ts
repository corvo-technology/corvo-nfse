import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  GoneException,
  BadRequestException,
  ParseIntPipe,
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
    const planRemaining = usage.blocked ? 0 : usage.included_remaining;
    return {
      // Plan notes nobody can use (lapsed plan) are not part of the balance.
      balance: planRemaining + usage.avulsoBalance,
      planRemaining,
      avulsoBalance: usage.avulsoBalance,
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

  @Get('purchase/preview')
  @ApiKeyEndpoint()
  @RequirePermission('credits.view')
  @ApiOperation({
    summary: 'Price a one-off purchase of N notes (R$ 0,99 each)',
  })
  previewPurchase(@Query('units', ParseIntPipe) units: number) {
    try {
      return this.creditsService.previewPurchase(units);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post('purchase/confirm')
  @RequirePermission('credits.manage')
  @ApiOperation({ summary: 'Moved: buy notes through POST /billing/checkout' })
  confirmPurchase() {
    throw new GoneException(
      'Notes are bought through POST /billing/checkout with kind "avulso"',
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
