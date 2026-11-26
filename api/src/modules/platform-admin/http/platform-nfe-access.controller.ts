import {
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import { data, type DataEnvelope } from '@/shared/http/response';
import { PlatformNfeAccessService } from '../application/platform-nfe-access.service';
import {
  PlatformAdminRoute,
  type RequestWithPlatformAdmin,
} from '../platform-admin.guard';
import type { NfeAccessResult } from '../platform-admin.contract';
import { PlatformNfeAccessDto } from './platform-nfe-access.dto';

/** Release of NF-e per workspace. Behind the platform admin guard: everyone else gets 404. */
@PlatformAdminRoute()
@Controller('platform/tenants')
export class PlatformNfeAccessController {
  constructor(private readonly access: PlatformNfeAccessService) {}

  @Put(':tenantId/nfe-access')
  @HttpCode(200)
  async set(
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
    @Body() body: PlatformNfeAccessDto,
  ): Promise<DataEnvelope<NfeAccessResult>> {
    return data(
      await this.access.set(req.platformAdmin!, tenantId, {
        enabled: body.enabled,
        reason: body.reason,
      }),
    );
  }
}
