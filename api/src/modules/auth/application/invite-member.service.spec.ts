import { InviteMemberService } from './invite-member.service';

describe('InviteMemberService', () => {
  it('persists the invited member name when creating the auth user', async () => {
    const authUserService = {
      createUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    const membershipService = {
      listForTenant: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    };
    const publishBestEffort = jest.fn();
    const service = new InviteMemberService(
      authUserService as never,
      membershipService as never,
      { publishBestEffort } as never,
      { revokeCreatedBy: jest.fn() } as never,
    );

    await service.invite('tenant-1', {
      name: 'John',
      email: 'john@gmail.com',
      role: 'developer',
    });

    expect(authUserService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'john@gmail.com',
        name: 'John',
      }),
    );
    expect(publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        notice: {
          kind: 'member-added',
          email: 'john@gmail.com',
          role: 'developer',
        },
      }),
    );
  });

  it('revokes the API keys a member created when the member is removed', async () => {
    const membership = { authUserId: 'user-1', isActive: true };
    const membershipService = {
      listForTenant: jest.fn().mockResolvedValue([membership]),
      update: jest.fn(),
    };
    const apiKeyService = { revokeCreatedBy: jest.fn() };
    const service = new InviteMemberService(
      {} as never,
      membershipService as never,
      {} as never,
      apiKeyService as never,
    );

    await service.removeMember('tenant-1', 'user-1');

    expect(membershipService.update).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
      'tenant-1',
    );
    expect(apiKeyService.revokeCreatedBy).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
    );
  });
});
