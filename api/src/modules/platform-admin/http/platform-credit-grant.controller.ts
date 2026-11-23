import {
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { PlatformCreditGrantService } from '../application/platform-credit-grant.service';
import {
  PlatformAdminRoute,
  type RequestWithPlatformAdmin,
} from '../platform-admin.guard';
import type { CreditGrantResult } from '../platform-admin.contract';
import { PlatformCreditGrantDto } from './platform-credit-grant.dto';

/** The only write of the platform admin. Not registered in self-hosted mode. */
@PlatformAdminRoute()
@Controller('platform/tenants')
export class PlatformCreditGrantController {
  constructor(private readonly grants: PlatformCreditGrantService) {}

  @Post(':tenantId/credit-grants')
  @HttpCode(200)
  async grant(
    @Req() req: RequestWithPlatformAdmin,
    @Param(
      'tenantId',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new NotFoundException({
            code: 'RESOURCE_NOT_FOUND',
            message: 'Resource not found',
          }),
      }),
    )
    tenantId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: PlatformCreditGrantDto,
  ): Promise<{ data: CreditGrantResult }> {
    const data = await this.grants.grant(
      req.platformAdmin!,
      tenantId,
      {
        amount: body.amount,
        reason: body.reason,
        notifyUser: body.notifyUser,
      },
      idempotencyKey,
    );
    return { data };
  }
}
