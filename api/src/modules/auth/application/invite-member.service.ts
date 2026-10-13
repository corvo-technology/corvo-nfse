import { CursorQuery } from '@/shared/http/pagination';
import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AuthUserService } from './auth-user.service';
import { MembershipService } from './membership.service';

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
  ) {}

  async invite(
    tenantId: string,
    dto: {
      email: string;
      role: 'admin' | 'developer' | 'billing';
      name: string;
    },
  ): Promise<{
    userId: string;
    email: string;
    role: string;
  }> {
    // Check if user already exists in this tenant
    const existingMembers =
      await this.membershipService.listForTenant(tenantId);

    // Create user (or get existing) — no password, invitee receives magic link
    const user = await this.authUserService.createUser({
      email: dto.email,
      name: dto.name,
    });

    // Check if membership already exists
    const existingMembership = existingMembers.find(
      (m) => m.authUserId === user.id,
    );
    if (existingMembership) {
      throw new ConflictException('User is already a member of this tenant');
    }

    // Create membership with role-based permissions
    await this.membershipService.create({
      authUserId: user.id,
      tenantId,
      role: dto.role,
    });

    return {
      userId: user.id,
      email: dto.email,
      role: dto.role,
    };
  }

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
    if (!membership) throw new NotFoundException('Member not found');
    // Mark as inactive
    await this.membershipService.update(
      {
        ...membership,
        isActive: false,
        updatedAt: new Date(),
      },
      tenantId,
    );
  }
}
