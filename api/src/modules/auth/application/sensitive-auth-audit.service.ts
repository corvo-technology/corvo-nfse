/* eslint-disable @typescript-eslint/await-thenable */
import { Injectable, Logger } from '@nestjs/common';
import {
  SensitiveAuthAuditAction,
  SensitiveAuthAuditEvent,
} from '../domain/sensitive-auth-audit';

export interface SensitiveAuthActor {
  authUserId: string;
  membershipId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SensitiveAuthAuditService {
  private readonly logger = new Logger(SensitiveAuthAuditService.name);

  async record(input: {
    actor: SensitiveAuthActor;
    tenantId?: string;
    action: SensitiveAuthAuditAction;
    targetType: SensitiveAuthAuditEvent['targetType'];
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<SensitiveAuthAuditEvent> {
    // Simplified: just log the audit event
    this.logger.log(
      `Audit: ${input.action} on ${input.targetType}:${input.targetId}`,
    );
    return {
      id: await crypto.randomUUID(),
      actorAuthUserId: input.actor.authUserId,
      actorMembershipId: input.actor.membershipId,
      tenantId: input.tenantId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      ipAddress: input.actor.ipAddress,
      userAgent: input.actor.userAgent,
      createdAt: new Date(),
    };
  }
}
