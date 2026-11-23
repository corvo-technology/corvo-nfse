import { Controller, Get, Query } from '@nestjs/common';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import {
  PlatformAdminAuditRepository,
  type PlatformAuditEvent as AuditRow,
} from '../infra/platform-admin-audit.repository';
import type { PlatformAuditEvent } from '../platform-admin.contract';
import { PlatformAdminRoute } from '../platform-admin.guard';

function toContract(row: AuditRow): PlatformAuditEvent {
  return {
    id: row.id,
    actorEmail: row.actorEmail,
    action: row.action,
    targetTenantId: row.targetTenantId,
    targetUserId: row.targetUserId,
    reason: row.reason,
    payload: row.payload,
    success: row.success,
    createdAt: row.createdAt.toISOString(),
  };
}

@PlatformAdminRoute()
@Controller('platform')
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAdminAuditRepository) {}

  @Get('audit')
  async list(
    @Query() options: CursorQuery,
  ): Promise<CursorPage<PlatformAuditEvent>> {
    const page = await this.audit.listPage(options);
    return page.map(toContract);
  }
}
