import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { data, type DataEnvelope } from '@/shared/http/response';
import { PlatformContingencyService } from '../application/platform-contingency.service';
import type { PlatformSvcState } from '../platform-admin.contract';
import {
  PlatformAdminRoute,
  type RequestWithPlatformAdmin,
} from '../platform-admin.guard';

export class PlatformSvcExitDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

/** Only `1` (production) and `2` (homologation) exist; anything else is an unknown resource. */
function tpAmbOf(value: string): 1 | 2 {
  if (value === '1') return 1;
  if (value === '2') return 2;
  throw new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message: 'Resource not found',
  });
}

/** The NF-e contingency (SVC) per UF. Behind the platform admin guard: everyone else gets 404. */
@PlatformAdminRoute()
@Controller('platform/contingency')
export class PlatformContingencyController {
  constructor(private readonly service: PlatformContingencyService) {}

  @Get()
  async list(): Promise<DataEnvelope<PlatformSvcState[]>> {
    return data(await this.service.list());
  }

  @Post(':uf/:tpAmb/exit')
  @HttpCode(200)
  async exit(
    @Req() req: RequestWithPlatformAdmin,
    @Param('uf') uf: string,
    @Param('tpAmb') tpAmb: string,
    @Body() body: PlatformSvcExitDto,
  ): Promise<DataEnvelope<{ uf: string; tpAmb: 1 | 2; mode: 'none' }>> {
    return data(
      await this.service.forceExit(
        req.platformAdmin!,
        uf,
        tpAmbOf(tpAmb),
        body.reason,
      ),
    );
  }
}
