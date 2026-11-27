import { createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import type { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { PlatformAdminAuditOrmEntity } from './platform-admin-audit.orm-entity';

export type PlatformAuditAction =
  | 'credit_grant'
  | 'user_viewed'
  // Old events: the NF-e release no longer exists, but the audit log keeps what was done.
  | 'nfe_access_changed'
  | 'nfce_access_set'
  | 'svc_forced_exit';

export interface PlatformAuditInput {
  actorUserId: string;
  actorEmail: string;
  action: PlatformAuditAction;
  targetTenantId?: string | null;
  targetUserId?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
  success: boolean;
  idempotencyKey?: string | null;
  ipHash?: string | null;
}

export interface PlatformAuditEvent {
  id: string;
  actorUserId: string;
  actorEmail: string;
  action: PlatformAuditAction;
  targetTenantId: string | null;
  targetUserId: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  success: boolean;
  idempotencyKey: string | null;
  createdAt: Date;
}

/** Keyed (HMAC-SHA256) so an IPv4 cannot be brute-forced out of the audit table. */
export function hashIp(ip: string | undefined, secret: string): string | null {
  return ip ? createHmac('sha256', secret).update(ip).digest('hex') : null;
}

function toEvent(row: PlatformAdminAuditOrmEntity): PlatformAuditEvent {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    action: row.action as PlatformAuditAction,
    targetTenantId: row.targetTenantId,
    targetUserId: row.targetUserId,
    reason: row.reason,
    payload: row.payload,
    success: row.success,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PlatformAdminAuditRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  /** Joins the ambient transaction (TypeOrmTransactionContext) when there is one. */
  async insert(input: PlatformAuditInput): Promise<PlatformAuditEvent> {
    const repo = this.db.manager().getRepository(PlatformAdminAuditOrmEntity);
    const saved = await repo.save(
      repo.create({
        id: randomUUID(),
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        action: input.action,
        targetTenantId: input.targetTenantId ?? null,
        targetUserId: input.targetUserId ?? null,
        reason: input.reason ?? null,
        payload: input.payload ?? {},
        success: input.success,
        idempotencyKey: input.idempotencyKey ?? null,
        ipHash: input.ipHash ?? null,
      }),
    );
    return toEvent(saved);
  }

  async findSuccessfulGrantByKey(
    key: string,
  ): Promise<PlatformAuditEvent | null> {
    const row = await this.db
      .manager()
      .getRepository(PlatformAdminAuditOrmEntity)
      .findOne({
        where: { action: 'credit_grant', success: true, idempotencyKey: key },
      });
    return row ? toEvent(row) : null;
  }

  listPage(options: CursorQuery): Promise<CursorPage<PlatformAuditEvent>> {
    return queryCursorPage(
      this.db
        .manager()
        .getRepository(PlatformAdminAuditOrmEntity)
        .createQueryBuilder('audit'),
      options,
      ['platform-admin-audit'],
      toEvent,
    );
  }
}
