import { Injectable, NotFoundException } from '@nestjs/common';
import type { PlatformAdminActor } from '../platform-admin.guard';
import type { PlatformUserDetail } from '../platform-admin.contract';
import { PlatformAdminAuditRepository } from '../infra/platform-admin-audit.repository';
import { PlatformUserDetailReadRepository } from '../infra/read/platform-user-detail.read-repository';

@Injectable()
export class PlatformUserDetailService {
  constructor(
    private readonly detail: PlatformUserDetailReadRepository,
    private readonly audit: PlatformAdminAuditRepository,
  ) {}

  /**
   * Reads run in the READ ONLY platform session (already closed here); the
   * `user_viewed` row is written afterwards, outside it, and BEFORE the data is
   * returned: if the audit fails the caller gets an error and no data.
   */
  async view(
    actor: PlatformAdminActor,
    userId: string,
  ): Promise<PlatformUserDetail> {
    const found = await this.detail.find(userId);
    if (!found) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    }
    await this.audit.insert({
      actorUserId: actor.authUserId,
      actorEmail: actor.email,
      action: 'user_viewed',
      targetUserId: userId,
      success: true,
      ipHash: actor.ipHash,
    });
    return found;
  }
}
