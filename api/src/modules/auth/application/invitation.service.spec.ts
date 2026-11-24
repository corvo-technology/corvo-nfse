import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { hashInvitationToken, InvitationService } from './invitation.service';
import type { TenantInvitation } from '../domain/tenant-invitation';

const TENANT = 'tenant-1';
const INVITER = 'inviter-1';
const USER = 'user-1';

function invitation(over: Partial<TenantInvitation> = {}): TenantInvitation {
  return {
    id: 'inv-1',
    tenantId: TENANT,
    email: 'maria@x.com',
    name: 'Maria',
    role: 'developer',
    permissions: [],
    status: 'pending',
    tokenHash: hashInvitationToken('good-token'),
    invitedByUserId: INVITER,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(Date.now() - 3_600_000),
    updatedAt: new Date(Date.now() - 3_600_000),
    ...over,
  };
}

function build(
  opts: {
    invitation?: TenantInvitation | null;
    user?: Record<string, unknown> | null;
    members?: Array<Record<string, unknown>>;
    claim?: boolean;
    pending?: TenantInvitation | null;
    open?: TenantInvitation[];
  } = {},
) {
  const invitations = {
    findPendingByEmailAndTenant: jest
      .fn()
      .mockResolvedValue(opts.pending ?? null),
    findByIdAndTenantId: jest.fn().mockResolvedValue(opts.invitation ?? null),
    listOpenByTenant: jest.fn().mockResolvedValue(opts.open ?? []),
    findByTokenHash: jest.fn(async (hash: string) =>
      opts.invitation && opts.invitation.tokenHash === hash
        ? opts.invitation
        : null,
    ),
    claim: jest.fn().mockResolvedValue(opts.claim ?? true),
    save: jest.fn(async (row: TenantInvitation) => row),
    update: jest.fn(async (row: TenantInvitation) => row),
  };
  const user =
    opts.user === undefined
      ? {
          id: USER,
          email: 'Maria@X.com',
          name: 'Maria S',
          emailVerifiedAt: new Date(),
        }
      : opts.user;
  const authUsers = {
    findByEmail: jest.fn().mockResolvedValue(null),
    updateName: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(async (id: string) =>
      id === INVITER ? { id, name: 'Ana', email: 'ana@x.com' } : user,
    ),
  };
  const memberships = {
    listForTenant: jest.fn().mockResolvedValue(opts.members ?? []),
    create: jest.fn(),
    update: jest.fn(),
  };
  const events = {
    publishBestEffort: jest.fn(),
    publishAndWait: jest.fn(),
  };
  const unitOfWork = {
    execute: jest.fn((work: () => Promise<unknown>) => work()),
  };
  const service = new InvitationService(
    invitations as never,
    authUsers as never,
    memberships as never,
    events as never,
    unitOfWork as never,
  );
  return { service, invitations, authUsers, memberships, events };
}

describe('InvitationService', () => {
  describe('invite', () => {
    it('stores only the token hash and sends the token by e-mail event', async () => {
      const f = build();
      const result = await f.service.invite(TENANT, INVITER, {
        email: ' Maria@X.com ',
        name: 'Maria',
        role: 'developer',
      });
      const [saved] = f.invitations.save.mock.calls[0];
      const notice = (
        (f.events.publishBestEffort.mock.calls as unknown[][])[0][0] as {
          notice: {
            token: string;
            email: string;
            kind: string;
            inviterName: string;
          };
        }
      ).notice;
      expect(saved.email).toBe('maria@x.com');
      expect(saved.status).toBe('pending');
      expect(saved.tokenHash).toBe(hashInvitationToken(notice.token));
      expect(JSON.stringify(result)).not.toContain(notice.token);
      expect(notice).toMatchObject({
        kind: 'member-invited',
        email: 'maria@x.com',
        name: 'Maria',
        inviterName: 'Ana',
      });
      expect(f.memberships.create).not.toHaveBeenCalled();
    });

    it('refuses someone who is already an active member', async () => {
      const f = build({ members: [{ authUserId: USER, isActive: true }] });
      f.authUsers.findByEmail.mockResolvedValue({ id: USER });
      await expect(
        f.service.invite(TENANT, INVITER, {
          email: 'maria@x.com',
          name: 'Maria',
          role: 'developer',
        }),
      ).rejects.toThrow(ConflictException);
      expect(f.invitations.save).not.toHaveBeenCalled();
    });

    it('allows inviting again someone who was removed', async () => {
      const f = build({ members: [{ authUserId: USER, isActive: false }] });
      f.authUsers.findByEmail.mockResolvedValue({ id: USER });
      await expect(
        f.service.invite(TENANT, INVITER, {
          email: 'maria@x.com',
          name: 'Maria',
          role: 'billing',
        }),
      ).resolves.toBeDefined();
    });

    it('replaces an older pending invitation and revokes it', async () => {
      const old = invitation({ id: 'old' });
      const f = build({ pending: old });
      await f.service.invite(TENANT, INVITER, {
        email: 'maria@x.com',
        name: 'Maria',
        role: 'developer',
      });
      expect(f.invitations.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'old', status: 'revoked' }),
        TENANT,
      );
    });

    it('does not resend within the cooldown', async () => {
      const f = build({ pending: invitation({ updatedAt: new Date() }) });
      await expect(
        f.service.invite(TENANT, INVITER, {
          email: 'maria@x.com',
          name: 'Maria',
          role: 'developer',
        }),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('caps the number of open invitations', async () => {
      const f = build({ open: Array.from({ length: 50 }, () => invitation()) });
      await expect(
        f.service.invite(TENANT, INVITER, {
          email: 'maria@x.com',
          name: 'Maria',
          role: 'developer',
        }),
      ).rejects.toMatchObject({
        response: { code: 'INVITATION_LIMIT_REACHED' },
      });
    });
  });

  describe('accept', () => {
    it('creates the membership, closes the invitation and tells the main admin', async () => {
      const f = build({ invitation: invitation() });
      const result = await f.service.accept(USER, 'good-token');
      expect(f.invitations.claim).toHaveBeenCalledWith(
        'inv-1',
        TENANT,
        USER,
        expect.any(Date),
      );
      expect(f.memberships.create).toHaveBeenCalledWith({
        authUserId: USER,
        tenantId: TENANT,
        role: 'developer',
      });
      expect(result).toEqual({ tenantId: TENANT, role: 'developer' });
      expect(f.events.publishBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          notice: expect.objectContaining({
            kind: 'member-joined',
            email: 'maria@x.com',
            role: 'developer',
          }),
        }),
      );
    });

    it('gives a new account the name the admin typed, so the team list shows it', async () => {
      const f = build({
        invitation: invitation({ name: 'Maria Souza' }),
        user: {
          id: USER,
          email: 'maria@x.com',
          name: '',
          emailVerifiedAt: new Date(),
        },
      });
      await f.service.accept(USER, 'good-token');
      expect(f.authUsers.updateName).toHaveBeenCalledWith(USER, 'Maria Souza');
    });

    it('also replaces a name that was only the start of the e-mail', async () => {
      const f = build({
        invitation: invitation({ name: 'Maria Souza' }),
        user: {
          id: USER,
          email: 'maria@x.com',
          name: 'Maria',
          emailVerifiedAt: new Date(),
        },
      });
      await f.service.accept(USER, 'good-token');
      expect(f.authUsers.updateName).toHaveBeenCalledWith(USER, 'Maria Souza');
    });

    it('keeps a name the person already chose', async () => {
      const f = build({ invitation: invitation({ name: 'Maria Souza' }) });
      await f.service.accept(USER, 'good-token');
      expect(f.authUsers.updateName).not.toHaveBeenCalled();
    });

    it('still accepts when saving the name fails', async () => {
      const f = build({
        invitation: invitation(),
        user: {
          id: USER,
          email: 'maria@x.com',
          name: '',
          emailVerifiedAt: new Date(),
        },
      });
      f.authUsers.updateName.mockRejectedValue(new Error('db down'));
      await expect(f.service.accept(USER, 'good-token')).resolves.toEqual({
        tenantId: TENANT,
        role: 'developer',
      });
    });

    it('reactivates a removed member with the invited role', async () => {
      const f = build({
        invitation: invitation({ role: 'billing' }),
        members: [
          { id: 'm1', authUserId: USER, isActive: false, role: 'developer' },
        ],
      });
      await f.service.accept(USER, 'good-token');
      expect(f.memberships.create).not.toHaveBeenCalled();
      expect(f.memberships.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm1', isActive: true, role: 'billing' }),
        TENANT,
      );
    });

    it('does not notify when the user was already an active member', async () => {
      const f = build({
        invitation: invitation(),
        members: [
          { id: 'm1', authUserId: USER, isActive: true, role: 'admin' },
        ],
      });
      await f.service.accept(USER, 'good-token');
      expect(f.memberships.create).not.toHaveBeenCalled();
      expect(f.memberships.update).not.toHaveBeenCalled();
      expect(f.events.publishBestEffort).not.toHaveBeenCalled();
    });

    it('rejects an unknown token', async () => {
      const f = build({ invitation: invitation() });
      await expect(f.service.accept(USER, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each(['completed', 'revoked', 'expired'] as const)(
      'rejects a %s invitation',
      async (status) => {
        const f = build({ invitation: invitation({ status }) });
        await expect(f.service.accept(USER, 'good-token')).rejects.toThrow(
          NotFoundException,
        );
        expect(f.memberships.create).not.toHaveBeenCalled();
      },
    );

    it('rejects an expired invitation with a clear error', async () => {
      const f = build({
        invitation: invitation({ expiresAt: new Date(Date.now() - 1000) }),
      });
      await expect(f.service.accept(USER, 'good-token')).rejects.toThrow(
        GoneException,
      );
    });

    it('rejects a signed-in user whose e-mail is not the invited one', async () => {
      const f = build({
        invitation: invitation(),
        user: { id: USER, email: 'other@x.com', emailVerifiedAt: new Date() },
      });
      await expect(f.service.accept(USER, 'good-token')).rejects.toThrow(
        ForbiddenException,
      );
      expect(f.invitations.claim).not.toHaveBeenCalled();
    });

    it('rejects an account whose e-mail was never verified', async () => {
      const f = build({
        invitation: invitation(),
        user: { id: USER, email: 'maria@x.com', emailVerifiedAt: null },
      });
      await expect(f.service.accept(USER, 'good-token')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets only one of two simultaneous accepts through', async () => {
      const f = build({ invitation: invitation(), claim: false });
      await expect(f.service.accept(USER, 'good-token')).rejects.toThrow(
        NotFoundException,
      );
      expect(f.memberships.create).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    it('shows the role and inviter only to the invited e-mail', async () => {
      const f = build({ invitation: invitation() });
      await expect(f.service.preview(USER, 'good-token')).resolves.toEqual({
        role: 'developer',
        invitedBy: 'Ana',
      });
      const other = build({
        invitation: invitation(),
        user: { id: USER, email: 'other@x.com', emailVerifiedAt: new Date() },
      });
      await expect(other.service.preview(USER, 'good-token')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('resend and revoke', () => {
    it('gives a resent invitation a new token and invalidates the old one', async () => {
      const f = build({ invitation: invitation() });
      await f.service.resend(TENANT, 'inv-1');
      const saved = f.invitations.update.mock.calls[0][0];
      expect(saved.tokenHash).not.toBe(hashInvitationToken('good-token'));
      expect(f.events.publishBestEffort).toHaveBeenCalledTimes(1);
    });

    it('revokes a pending invitation', async () => {
      const f = build({ invitation: invitation() });
      await f.service.revoke(TENANT, 'inv-1');
      expect(f.invitations.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'revoked' }),
        TENANT,
      );
    });

    it('cannot revoke what is already used', async () => {
      const f = build({ invitation: invitation({ status: 'completed' }) });
      await expect(f.service.revoke(TENANT, 'inv-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
