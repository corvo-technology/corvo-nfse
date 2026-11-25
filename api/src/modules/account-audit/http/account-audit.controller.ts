import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { IAccountAuditRepository } from '../domain/account-audit.repository';
import { ListAuditEventsQuery } from './list-audit-events.query';

/** Session-only (no @ApiKeyEndpoint): the audit trail is a dashboard feature, not public API. */
@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('audit')
@Controller('audit-events')
export class AccountAuditController {
  constructor(private readonly audit: IAccountAuditRepository) {}

  @Get()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Who did what and when in this account' })
  list(
    @Query() query: ListAuditEventsQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return this.audit.listPage(
      auth.activeTenantId,
      executionEnvironment(auth),
      { actorType: query.actor_type, from: query.from, to: query.to },
      { limit: query.limit, cursor: query.cursor },
    );
  }
}
