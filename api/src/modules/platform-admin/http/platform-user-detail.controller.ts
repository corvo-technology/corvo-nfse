import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { data, type DataEnvelope } from '@/shared/http/response';
import { PlatformUserDetailService } from '../application/platform-user-detail.service';
import type { PlatformUserDetail } from '../platform-admin.contract';
import {
  PlatformAdminRoute,
  type RequestWithPlatformAdmin,
} from '../platform-admin.guard';

/** Invalid ids are indistinguishable from unknown ones: 404 RESOURCE_NOT_FOUND. */
export const ParsePlatformUserIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource not found',
    }),
});

@PlatformAdminRoute()
@Controller('platform/users')
export class PlatformUserDetailController {
  constructor(private readonly service: PlatformUserDetailService) {}

  @Get(':id')
  async get(
    @Req() req: RequestWithPlatformAdmin,
    @Param('id', ParsePlatformUserIdPipe) id: string,
  ): Promise<DataEnvelope<PlatformUserDetail>> {
    const actor = req.platformAdmin;
    if (!actor) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    return data(await this.service.view(actor, id));
  }
}
