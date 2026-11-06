import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { data } from '@/shared/http/response';
import {
  CursorPage,
  invalidCursor,
  normalizeLimit,
} from '@/shared/http/pagination';
import { ScheduleService } from '../application/schedule.service';
import type { InvoiceSchedule } from '../domain/invoice-schedule';
import { ScheduleNotFoundError } from '../domain/schedule-errors';
import {
  ListSchedulesQuery,
  ScheduleRunResponseDto,
  UpdateScheduleDto,
  toScheduleResponse,
} from './schedule.dto';

/** The cursor is the offset of the next item: schedules are few (at most 200 active per workspace). */
function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) return invalidCursor();
  return offset;
}

function pageOf<T>(items: T[], total: number, limit: number, offset: number) {
  const next = offset + items.length;
  return new CursorPage(items, {
    limit,
    hasMore: next < total,
    nextCursor: next < total ? String(next) : null,
  });
}

@ApiTags('schedules')
@UseGuards(ExecutionEnvironmentGuard)
@Controller('schedules')
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService) {}

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'List scheduled and recurring invoices' })
  async list(
    @Query() query: ListSchedulesQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    const limit = normalizeLimit(query.limit);
    const offset = offsetOf(query.cursor);
    const result = await this.schedules.list(
      req.authContext!.activeTenantId,
      {
        status: query.status,
        companyId: query.companyId,
        environment: executionEnvironment(req.authContext!),
      },
      { limit, offset },
    );
    return pageOf(
      result.items.map(toScheduleResponse),
      result.total,
      limit,
      offset,
    );
  }

  @Get(':id')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'Get a schedule' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    return data(toScheduleResponse(await this.owned(id, req)));
  }

  @Get(':id/runs')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({
    summary: 'Log of every attempt to run a schedule, newest first',
  })
  async runs(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListSchedulesQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    await this.owned(id, req);
    const limit = normalizeLimit(query.limit);
    const offset = offsetOf(query.cursor);
    const result = await this.schedules.runs(
      id,
      req.authContext!.activeTenantId,
      { limit, offset },
    );
    const items: ScheduleRunResponseDto[] = result.items.map((run) => ({
      id: run.id,
      occurrence_on: run.occurrenceOn,
      ran_on: run.ranOn,
      attempt: run.attempt,
      outcome: run.outcome,
      invoice_id: run.invoiceId,
      error_code: run.errorCode,
      error_message: run.errorMessage,
      created_at: run.createdAt.toISOString(),
    }));
    return pageOf(items, result.total, limit, offset);
  }

  @Patch(':id')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change a schedule; applies to the next runs only' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateScheduleDto,
    @Req() req: RequestWithAuthContext,
  ) {
    await this.owned(id, req);
    const schedule = await this.schedules.update(
      id,
      req.authContext!.activeTenantId,
      {
        invoice: dto.invoice,
        endsOn: dto.endsOn,
        frequency: dto.frequency,
        anchorOn: dto.anchorOn,
      },
    );
    return data(toScheduleResponse(schedule));
  }

  @Post(':id/pause')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({ summary: 'Pause a schedule' })
  async pause(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    await this.owned(id, req);
    return data(
      toScheduleResponse(
        await this.schedules.pause(id, req.authContext!.activeTenantId),
      ),
    );
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({ summary: 'Resume a paused schedule at its next occurrence' })
  async resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    await this.owned(id, req);
    return data(
      toScheduleResponse(
        await this.schedules.resume(id, req.authContext!.activeTenantId),
      ),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({ summary: 'Cancel a schedule (final)' })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    await this.owned(id, req);
    return data(
      toScheduleResponse(
        await this.schedules.cancel(id, req.authContext!.activeTenantId),
      ),
    );
  }

  /** A test key only sees test schedules, a live key only live ones. */
  private async owned(
    id: string,
    req: RequestWithAuthContext,
  ): Promise<InvoiceSchedule> {
    const schedule = await this.schedules.get(
      id,
      req.authContext!.activeTenantId,
    );
    if (schedule.props.environment !== executionEnvironment(req.authContext!))
      throw new ScheduleNotFoundError();
    return schedule;
  }
}
