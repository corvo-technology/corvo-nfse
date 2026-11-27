import { ForbiddenException } from '@nestjs/common';
import { PasswordlessWorkspaceService } from './passwordless-workspace.service';
import type { AuthUser } from '../domain/auth-user';
import { permissionsForTenantRole } from '../domain/permission';

const user: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.com',
  name: 'Owner',
  emailVerifiedAt: null,
  primaryIdentityType: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
function build(mode: 'cloud' | 'self_hosted' = 'cloud') {
  let active = false;
  const unitOfWork = {
    execute: jest.fn(async (work: () => Promise<void>) => {
      active = true;
      try {
        await work();
      } finally {
        active = false;
      }
    }),
  };
  const workspaces = {
    lockUser: jest.fn(async () => {
      expect(active).toBe(true);
    }),
    memberships: jest.fn().mockResolvedValue([]),
    freePlanId: jest.fn().mockResolvedValue('free-plan'),
    selfHostedPlanId: jest.fn().mockResolvedValue('self-hosted-plan'),
    claimWelcomeNotes: jest.fn().mockResolvedValue(true),
    create: jest.fn(async () => {
      expect(active).toBe(true);
    }),
  };
  return {
    service: new PasswordlessWorkspaceService(
      unitOfWork as never,
      workspaces,
      mode,
    ),
    unitOfWork,
    workspaces,
  };
}

describe('PasswordlessWorkspaceService', () => {
  it('assigns the self-hosted plan and no free note in self_hosted', async () => {
    const f = build('self_hosted');
    await f.service.ensureWorkspace(user);
    expect(f.workspaces.freePlanId).not.toHaveBeenCalled();
    expect(f.workspaces.claimWelcomeNotes).not.toHaveBeenCalled();
    expect(f.workspaces.create).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'self-hosted-plan',
        grantWelcomeNotes: false,
      }),
    );
  });

  it('creates the initial workspace inside the locked transaction', async () => {
    const f = build();
    await f.service.ensureWorkspace(user);
    expect(f.workspaces.lockUser).toHaveBeenCalledWith(user.id);
    expect(f.workspaces.lockUser.mock.invocationCallOrder[0]).toBeLessThan(
      f.workspaces.memberships.mock.invocationCallOrder[0],
    );
    expect(f.workspaces.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: user.id,
        authUserId: user.id,
        planId: 'free-plan',
        billingEmail: user.email,
        role: 'admin',
        permissions: permissionsForTenantRole('admin'),
        currentPeriodStart: expect.any(Date),
        currentPeriodEnd: expect.any(Date),
      }),
    );
  });
  it('leaves an existing active membership alone', async () => {
    const f = build();
    f.workspaces.memberships.mockResolvedValue([
      { isActive: true, tenantId: user.id },
    ]);
    await f.service.ensureWorkspace(user);
    expect(f.workspaces.freePlanId).not.toHaveBeenCalled();
    expect(f.workspaces.create).not.toHaveBeenCalled();
  });
  it('rejects inactive memberships', async () => {
    const f = build();
    f.workspaces.memberships.mockResolvedValue([
      { isActive: false, tenantId: user.id },
    ]);
    await expect(f.service.ensureWorkspace(user)).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.workspaces.create).not.toHaveBeenCalled();
  });
  it('gives an invited user their own workspace instead of only the inviter tenant', async () => {
    const f = build();
    f.workspaces.memberships.mockResolvedValue([
      { isActive: true, tenantId: 'inviter-tenant' },
    ]);
    await f.service.ensureWorkspace(user);
    expect(f.workspaces.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: user.id }),
    );
  });
  it('does not lock out a user whose invite was removed', async () => {
    const f = build();
    f.workspaces.memberships.mockResolvedValue([
      { isActive: false, tenantId: 'inviter-tenant' },
    ]);
    await f.service.ensureWorkspace(user);
    expect(f.workspaces.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: user.id }),
    );
  });
  it('grants the welcome notes when the normalized e-mail claims it', async () => {
    const f = build();
    await f.service.ensureWorkspace({ ...user, email: 'Owner+x@Example.com' });
    expect(f.workspaces.claimWelcomeNotes).toHaveBeenCalledWith(
      'owner@example.com',
      user.id,
    );
    expect(f.workspaces.create).toHaveBeenCalledWith(
      expect.objectContaining({ grantWelcomeNotes: true }),
    );
  });
  it('still creates the workspace, without the welcome notes, when it was already claimed', async () => {
    const f = build();
    f.workspaces.claimWelcomeNotes.mockResolvedValue(false);
    await f.service.ensureWorkspace(user);
    expect(f.workspaces.create).toHaveBeenCalledWith(
      expect.objectContaining({ grantWelcomeNotes: false }),
    );
  });
  it('propagates persistence failures to the unit of work', async () => {
    const f = build();
    f.workspaces.create.mockRejectedValue(new Error('write failed'));
    await expect(f.service.ensureWorkspace(user)).rejects.toThrow(
      'write failed',
    );
  });
});
