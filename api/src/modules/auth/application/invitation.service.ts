import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';
import { authorizationContextChanged } from './authorization.events';
import { AuthUserService } from './auth-user.service';
import { MembershipService } from './membership.service';
import type { AuthUser } from '../domain/auth-user';
import { permissionsForTenantRole } from '../domain/permission';
import type { TenantInvitation } from '../domain/tenant-invitation';
import type { TenantMembershipRole } from '../domain/tenant-membership';
import { ITenantInvitationRepository } from '../domain/tenant-invitation.repository';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OPEN_INVITATIONS = 50;
const MAX_TOKEN_LENGTH = 128;

export type InviteInput = {
  email: string;
  name: string;
  role: TenantMembershipRole;
};

export type InvitationSummary = {
  id: string;
  email: string;
  name: string;
  role: TenantMembershipRole;
  expiresAt: Date;
  createdAt: Date;
};

/** A name the person (or an admin) gave, not the part of the e-mail before the "@". */
function hasRealName(user: AuthUser): boolean {
  const name = user.name.trim().toLowerCase();
  return name !== '' && name !== user.email.split('@')[0].trim().toLowerCase();
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function summary(invitation: TenantInvitation): InvitationSummary {
  return {
    id: invitation.id,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

const invalid = () =>
  new NotFoundException({
    code: 'INVITATION_INVALID',
    message: 'This invitation is invalid or was already used',
  });

/**
 * A member joins only by accepting an invitation: the admin invites an e-mail,
 * the invitee gets a single-use link, signs in with that same e-mail and accepts.
 */
@Injectable()
export class InvitationService {
  constructor(
    private readonly invitations: ITenantInvitationRepository,
    private readonly authUsers: AuthUserService,
    private readonly memberships: MembershipService,
    private readonly events: ApplicationEventBus,
    private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async invite(
    tenantId: string,
    invitedByUserId: string,
    input: InviteInput,
  ): Promise<InvitationSummary> {
    const email = input.email.trim().toLowerCase();

    const existingUser = await this.authUsers.findByEmail(email);
    if (existingUser) {
      const members = await this.memberships.listForTenant(tenantId);
      if (members.some((m) => m.authUserId === existingUser.id && m.isActive))
        throw new ConflictException({
          code: 'MEMBER_ALREADY_EXISTS',
          message: 'User is already a member of this tenant',
        });
    }

    const pending = await this.invitations.findPendingByEmailAndTenant(
      email,
      tenantId,
    );
    if (pending) {
      this.assertCooldown(pending);
      await this.close(pending, 'revoked');
    }

    const open = await this.invitations.listOpenByTenant(tenantId);
    if (open.length >= MAX_OPEN_INVITATIONS)
      throw new BadRequestException({
        code: 'INVITATION_LIMIT_REACHED',
        message: 'Too many pending invitations. Revoke some before inviting.',
      });

    const now = new Date();
    const token = this.newToken();
    const saved = await this.invitations.save(
      {
        id: crypto.randomUUID(),
        tenantId,
        email,
        name: input.name.trim(),
        role: input.role,
        permissions: permissionsForTenantRole(input.role),
        status: 'pending',
        tokenHash: hashInvitationToken(token),
        invitedByUserId,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        createdAt: now,
        updatedAt: now,
      },
      tenantId,
    );
    await this.sendInvitation(saved, token);
    return summary(saved);
  }

  async listOpen(tenantId: string): Promise<InvitationSummary[]> {
    return (await this.invitations.listOpenByTenant(tenantId)).map(summary);
  }

  /** A new link and a fresh 7 days; the previous link stops working. */
  async resend(tenantId: string, id: string): Promise<InvitationSummary> {
    const invitation = await this.findOpen(tenantId, id);
    this.assertCooldown(invitation);
    const now = new Date();
    const token = this.newToken();
    const saved = await this.invitations.update(
      {
        ...invitation,
        tokenHash: hashInvitationToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        updatedAt: now,
      },
      tenantId,
    );
    await this.sendInvitation(saved, token);
    return summary(saved);
  }

  async revoke(tenantId: string, id: string): Promise<void> {
    await this.close(await this.findOpen(tenantId, id), 'revoked');
  }

  /** What the invitee is about to accept; only for the invited, signed-in e-mail. */
  async preview(
    authUserId: string,
    token: string,
  ): Promise<{ role: TenantMembershipRole; invitedBy: string }> {
    const user = await this.authUsers.findById(authUserId);
    return runAsSystem('invitation-accept', async () => {
      const invitation = await this.usable(token, user);
      const inviter = invitation.invitedByUserId
        ? await this.authUsers.findById(invitation.invitedByUserId)
        : null;
      return {
        role: invitation.role,
        invitedBy: inviter?.name || inviter?.email || '',
      };
    });
  }

  async accept(
    authUserId: string,
    token: string,
  ): Promise<{ tenantId: string; role: TenantMembershipRole }> {
    const user = await this.authUsers.findById(authUserId);
    const result = await runAsSystem('invitation-accept', () =>
      this.unitOfWork.execute(async () => {
        const invitation = await this.usable(token, user);
        // Single use: only one concurrent accept gets past this line.
        if (
          !(await this.invitations.claim(
            invitation.id,
            invitation.tenantId,
            authUserId,
            new Date(),
          ))
        )
          throw invalid();

        const members = await this.memberships.listForTenant(
          invitation.tenantId,
        );
        const existing = members.find((m) => m.authUserId === authUserId);
        if (existing?.isActive) return { invitation, joined: false as const };
        if (existing)
          await this.memberships.update(
            {
              ...existing,
              role: invitation.role,
              isActive: true,
              updatedAt: new Date(),
            },
            invitation.tenantId,
          );
        else
          await this.memberships.create({
            authUserId,
            tenantId: invitation.tenantId,
            role: invitation.role,
          });
        return { invitation, joined: true as const };
      }),
    );

    // A new account has no name yet: use the one the admin gave, so the team list shows it.
    // The person can change it in Settings. A failure here must not undo the acceptance.
    if (user && result.invitation.name && !hasRealName(user))
      await this.authUsers
        .updateName(user.id, result.invitation.name)
        .catch(() => undefined);

    // Again after commit, so no cached copy of the old access list survives.
    await this.events.publishAndWait(authorizationContextChanged(authUserId));
    if (result.joined)
      this.events.publishBestEffort(
        accountNotice(result.invitation.tenantId, {
          kind: 'member-joined',
          name: user?.name || result.invitation.name,
          email: result.invitation.email,
          role: result.invitation.role,
        }),
      );
    return {
      tenantId: result.invitation.tenantId,
      role: result.invitation.role,
    };
  }

  private async usable(
    token: string,
    user: AuthUser | null,
  ): Promise<TenantInvitation> {
    if (!token || token.length > MAX_TOKEN_LENGTH) throw invalid();
    const invitation = await this.invitations.findByTokenHash(
      hashInvitationToken(token),
    );
    if (!invitation || invitation.status !== 'pending') throw invalid();
    if (invitation.expiresAt.getTime() <= Date.now())
      throw new GoneException({
        code: 'INVITATION_EXPIRED',
        message: 'This invitation has expired. Ask for a new one.',
      });
    // The e-mail on the account must be the invited one, and proven by sign-in.
    if (
      !user?.emailVerifiedAt ||
      user.email.trim().toLowerCase() !== invitation.email
    )
      throw new ForbiddenException({
        code: 'INVITATION_EMAIL_MISMATCH',
        message: 'Sign in with the e-mail address that received the invitation',
      });
    return invitation;
  }

  private async findOpen(
    tenantId: string,
    id: string,
  ): Promise<TenantInvitation> {
    const invitation = await this.invitations.findByIdAndTenantId(id, tenantId);
    if (!invitation || invitation.status !== 'pending')
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    return invitation;
  }

  private assertCooldown(invitation: TenantInvitation): void {
    if (Date.now() - invitation.updatedAt.getTime() < RESEND_COOLDOWN_MS)
      throw new HttpException(
        {
          code: 'INVITATION_RECENTLY_SENT',
          message: 'An invitation was just sent. Try again in a minute.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private async close(
    invitation: TenantInvitation,
    status: 'revoked',
  ): Promise<void> {
    await this.invitations.update(
      { ...invitation, status, updatedAt: new Date() },
      invitation.tenantId,
    );
  }

  private newToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private async sendInvitation(
    invitation: TenantInvitation,
    token: string,
  ): Promise<void> {
    const inviter = invitation.invitedByUserId
      ? await this.authUsers.findById(invitation.invitedByUserId)
      : null;
    this.events.publishBestEffort(
      accountNotice(invitation.tenantId, {
        kind: 'member-invited',
        email: invitation.email,
        name: invitation.name,
        role: invitation.role,
        token,
        inviterName: inviter?.name || inviter?.email || undefined,
      }),
    );
  }
}
