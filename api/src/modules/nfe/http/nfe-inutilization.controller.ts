import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { NfeRoute } from '@/modules/fiscal-core/http/nfe-enabled.guard';
import { data } from '@/shared/http/response';
import { NfeInutilizeService } from '../application/nfe-inutilize.service';
import { TypeormNfeInutilizations } from '../infra/typeorm-nfe-inutilizations';
import { NfeNumberGapsQuery } from '../infra/typeorm-nfe-number-gaps.query';
import {
  InutilizeNfeDto,
  ListInutilizationsQuery,
  NumberGapsQuery,
  toNfeInutilizationResponse,
  toNfeNumberGapResponse,
} from './nfe-event.dto';

interface ResponseLike {
  status(code: number): unknown;
}

/**
 * Inutilization of number ranges and the numbering gaps. Declared before `NfeController` in the
 * module: `GET /nfe/inutilizations` must not be read as `GET /nfe/:id`.
 */
@UseGuards(ExecutionEnvironmentGuard)
@NfeRoute()
@ApiTags('nfe')
@Controller('nfe')
export class NfeInutilizationController {
  constructor(
    private readonly service: NfeInutilizeService,
    private readonly inutilizations: TypeormNfeInutilizations,
    private readonly gaps: NfeNumberGapsQuery,
  ) {}

  @Post('inutilizations')
  @HttpCode(202)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.manage')
  @ApiOperation({ summary: 'Inutilize a range of NF-e numbers' })
  @ApiHeader({ name: 'idempotency-key', required: false })
  async create(
    @Body() dto: InutilizeNfeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const context = req.authContext!;
    const result = await this.service.create(
      context.activeTenantId,
      executionEnvironment(context),
      dto,
      idempotencyKey,
    );
    if (result.replayed) res.status(200);
    return data({
      ...toNfeInutilizationResponse(result.inutilization),
      ...(result.replayed ? { replayed: true as const } : {}),
    });
  }

  @Get('inutilizations')
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({ summary: 'List NF-e inutilizations, newest first' })
  @ApiCursorResponse()
  async list(
    @Query() query: ListInutilizationsQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    const page = await this.inutilizations.list(
      context.activeTenantId,
      executionEnvironment(context),
      query,
    );
    return page.map(toNfeInutilizationResponse);
  }

  @Get('number-gaps')
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({
    summary: 'Numbers that no NF-e uses and no inutilization covers',
  })
  async numberGaps(
    @Query() query: NumberGapsQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    const found = await this.gaps.list(
      context.activeTenantId,
      executionEnvironment(context),
      query.companyId,
    );
    return data(found.map(toNfeNumberGapResponse));
  }
}
