import { ConflictException, ForbiddenException } from '@nestjs/common';
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
function build() {
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
    hasFreeWorkspaceWithEmail: jest.fn().mockResolvedValue(false),
    create: jest.fn(async () => {
      expect(active).toBe(true);
    }),
  };
  return {
    service: new PasswordlessWorkspaceService(unitOfWork as never, workspaces),
    unitOfWork,
    workspaces,
  };
}

describe('PasswordlessWorkspaceService', () => {
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
    f.workspaces.memberships.mockResolvedValue([{ isActive: true }]);
    await f.service.ensureWorkspace(user);
    expect(f.workspaces.freePlanId).not.toHaveBeenCalled();
    expect(f.workspaces.create).not.toHaveBeenCalled();
  });
  it('rejects inactive memberships', async () => {
    const f = build();
    f.workspaces.memberships.mockResolvedValue([{ isActive: false }]);
    await expect(f.service.ensureWorkspace(user)).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.workspaces.create).not.toHaveBeenCalled();
  });
  it('rejects a reused free-workspace email', async () => {
    const f = build();
    f.workspaces.hasFreeWorkspaceWithEmail.mockResolvedValue(true);
    await expect(f.service.ensureWorkspace(user)).rejects.toThrow(
      ConflictException,
    );
    expect(f.workspaces.hasFreeWorkspaceWithEmail).toHaveBeenCalledWith(
      user.email,
      'free-plan',
    );
    expect(f.workspaces.create).not.toHaveBeenCalled();
  });
  it('propagates persistence failures to the unit of work', async () => {
    const f = build();
    f.workspaces.create.mockRejectedValue(new Error('write failed'));
    await expect(f.service.ensureWorkspace(user)).rejects.toThrow(
      'write failed',
    );
  });
});
