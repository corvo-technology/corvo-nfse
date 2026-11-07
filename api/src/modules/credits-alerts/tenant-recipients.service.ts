import { Injectable } from '@nestjs/common';
import { MembershipService } from '@/modules/auth/application/membership.service';
import { AuthUserService } from '@/modules/auth/application/auth-user.service';

/** Only these members receive billing and scheduling warnings. */
const RECIPIENT_ROLES = new Set(['admin', 'billing']);
const ADMIN_ROLES = new Set(['admin']);

/** Who to tell about money and scheduling problems of a workspace. */
@Injectable()
export class TenantRecipientsService {
  constructor(
    private readonly memberships: MembershipService,
    private readonly users: AuthUserService,
  ) {}

  /** Active admin and billing members' e-mails, lower-cased, without duplicates. */
  async emailsFor(tenantId: string): Promise<string[]> {
    return this.emailsWithRoles(tenantId, RECIPIENT_ROLES);
  }

  /** Active admins only: security notices (API keys, connected apps). */
  async adminEmailsFor(tenantId: string): Promise<string[]> {
    return this.emailsWithRoles(tenantId, ADMIN_ROLES);
  }

  private async emailsWithRoles(
    tenantId: string,
    roles: Set<string>,
  ): Promise<string[]> {
    const members = (await this.memberships.listForTenant(tenantId)).filter(
      (member) => member.isActive && roles.has(member.role),
    );
    if (members.length === 0) return [];
    const users = await this.users.getUsersByIds(
      members.map((member) => member.authUserId),
      tenantId,
    );
    const emails = members.flatMap((member) => {
      const address = users.get(member.authUserId)?.email?.trim();
      return address ? [address.toLowerCase()] : [];
    });
    return [...new Set(emails)];
  }
}
