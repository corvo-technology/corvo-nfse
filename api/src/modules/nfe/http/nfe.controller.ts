import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { NfeConsultService } from '../application/nfe-consult.service';
import { nfeNotFound } from '../application/nfe-errors';
import {
  NfeIntakeService,
  type NfeSubmitted,
} from '../application/nfe-intake.service';
import { NfeResubmitService } from '../application/nfe-resubmit.service';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { NfeRequestDto } from './nfe.dto';
import {
  ListNfeQuery,
  toNfeResponse,
  type NfeAcceptedResponse,
} from './nfe-response.dto';
import { Inject } from '@nestjs/common';

interface ResponseLike {
  status(code: number): unknown;
}

/** 202 for a new NF-e, 200 when the `Idempotency-Key` had already created it. */
function accepted(
  result: NfeSubmitted,
  response: ResponseLike,
): NfeAcceptedResponse {
  if (result.replayed) response.status(200);
  return {
    id: result.id,
    status: result.status,
    ...(result.replayed ? { replayed: true as const } : {}),
  };
}

@UseGuards(ExecutionEnvironmentGuard)
@NfeRoute()
@ApiTags('nfe')
@Controller('nfe')
export class NfeController {
  constructor(
    private readonly intake: NfeIntakeService,
    private readonly consult: NfeConsultService,
    private readonly resubmission: NfeResubmitService,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.issue')
  @ApiOperation({ summary: 'Issue an NF-e (asynchronous)' })
  @ApiHeader({ name: 'idempotency-key', required: true })
  async create(
    @Body() dto: NfeRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const key = NfeIntakeService.assertIdempotencyKey(idempotencyKey);
    const context = req.authContext!;
    const result = await this.intake.submit(
      context.activeTenantId,
      executionEnvironment(context),
      dto,
      key,
    );
    return data(accepted(result, res));
  }

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({ summary: 'List NF-e, newest first' })
  @ApiCursorResponse()
  async list(@Query() query: ListNfeQuery, @Req() req: RequestWithAuthContext) {
    const context = req.authContext!;
    const page = await this.documents.list(
      context.activeTenantId,
      executionEnvironment(context),
      query,
    );
    return page.map(toNfeResponse);
  }

  @Get(':id')
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({ summary: 'Get an NF-e' })
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    const doc = await this.documents.findById(
      id,
      context.activeTenantId,
      executionEnvironment(context),
    );
    if (!doc) throw nfeNotFound();
    return data(toNfeResponse(doc));
  }

  @Post(':id/sync')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.manage')
  @ApiOperation({ summary: 'Ask the SEFAZ about the NF-e by its key' })
  async sync(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    const doc = await this.consult.sync(
      id,
      context.activeTenantId,
      executionEnvironment(context),
      'manual',
    );
    return data(toNfeResponse(doc));
  }

  @Put(':id')
  @HttpCode(202)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.issue')
  @ApiOperation({ summary: 'Correct and send a rejected NF-e again' })
  async resubmit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: NfeRequestDto,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const context = req.authContext!;
    const result = await this.resubmission.resubmit(
      id,
      context.activeTenantId,
      executionEnvironment(context),
      dto,
    );
    return data(accepted(result, res));
  }

  @Post(':id/discard')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.manage')
  @ApiOperation({ summary: 'Give up a rejected NF-e' })
  async discard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    const doc = await this.resubmission.discard(
      id,
      context.activeTenantId,
      executionEnvironment(context),
    );
    return data(toNfeResponse(doc));
  }
}
