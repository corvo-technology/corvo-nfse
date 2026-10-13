import { LastTenantAdminError } from '../domain/errors';
import { ITenantMembershipRepository } from '../domain/tenant-membership.repository';
import { makeMembership } from './auth-test-fixtures';
import { MembershipService } from './membership.service';

function setup() {
  const repository: jest.Mocked<ITenantMembershipRepository> = {
    findByIdAndTenantId: jest.fn(),
    findByAuthUserAndTenant: jest.fn(),
    listActiveByAuthUser: jest.fn(),
    listActiveByAuthUserAndProduct: jest.fn(),
    listActiveWithEstablishmentByAuthUserAndProduct: jest.fn(),
    findByAuthUserTenantAndProduct: jest.fn(),
    listActiveByTenant: jest.fn(),
    listPage: jest.fn(),
    listByTenant: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const events = { publishAndWait: jest.fn().mockResolvedValue(undefined) };
  return {
    repository,
    events,
    service: new MembershipService(repository, events as never),
  };
}

describe(MembershipService.name, () => {
  it('persists canonical permissions and invalidates the member context', async () => {
    const { service, repository, events } = setup();
    repository.save.mockImplementation(async (membership) => membership);

    const membership = await service.create({
      authUserId: 'auth-1',
      tenantId: 'tenant-1',
      role: 'developer',
    });

    expect(membership.permissions).toContain('webhooks.manage');
    expect(membership.permissions).not.toContain('settings.manage');
    expect(events.publishAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId: 'auth-1' }),
    );
  });

  it('does not permit removal of the last active tenant admin', async () => {
    const { service, repository } = setup();
    const admin = makeMembership({ role: 'admin' });
    repository.findByIdAndTenantId.mockResolvedValue(admin);
    repository.listActiveByTenant.mockResolvedValue([admin]);

    await expect(
      service.update({ ...admin, isActive: false }, admin.tenantId),
    ).rejects.toThrow(LastTenantAdminError);
  });
});
