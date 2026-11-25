import { CursorQuery } from '@/shared/http/pagination';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { AuthUserService } from './auth-user.service';
import { MembershipService } from './membership.service';
import { ApiKeyService } from './api-key.service';

@Injectable()
export class InviteMemberService {
  async listMembersPage(tenantId: string, options: CursorQuery) {
    const members = await this.membershipService.listPage(tenantId, options);
    const usersMap = await this.authUserService.getUsersByIds(
      members.data.map((m) => m.authUserId),
      tenantId,
    );
    return members.map((m) => ({
      id: m.authUserId,
      email: usersMap.get(m.authUserId)?.email ?? '',
      name: usersMap.get(m.authUserId)?.name ?? '',
      role: m.role,
      createdAt: m.createdAt,
    }));
  }

  constructor(
    private readonly authUserService: AuthUserService,
    private readonly membershipService: MembershipService,
    private readonly apiKeyService: ApiKeyService,
    private readonly audit: AccountAuditRecorder,
  ) {}

  async listMembers(tenantId: string): Promise<any[]> {
    const members = await this.membershipService.listForTenant(tenantId);
    const userIds = members.map((m) => m.authUserId);
    const usersMap = await this.authUserService.getUsersByIds(
      userIds,
      tenantId,
    );

    return members.map((m) => {
      const user = usersMap.get(m.authUserId);
      return {
        id: m.authUserId,
        email: user?.email ?? '',
        name: user?.name ?? '',
        role: m.role,
        createdAt: m.createdAt,
      };
    });
  }

  async removeMember(tenantId: string, userId: string): Promise<void> {
    const members = await this.membershipService.listForTenant(tenantId);
    const membership = members.find((m) => m.authUserId === userId);
    if (!membership)
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Member not found',
      });
    // The name is only a label for the trail: never let its lookup stop the removal.
    const name = await this.authUserService
      .getUsersByIds([userId], tenantId)
      .then((users) => users.get(userId)?.name)
      .catch(() => undefined);
    // Mark as inactive
    await this.membershipService.update(
      {
        ...membership,
        isActive: false,
        updatedAt: new Date(),
      },
      tenantId,
    );
    // A removed member must not keep API access through keys they created.
    await this.apiKeyService.revokeCreatedBy(tenantId, userId);
    await this.audit.record({
      tenantId,
      action: 'member.removed',
      target: { type: 'member', id: userId, label: name || null },
    });
  }
}
