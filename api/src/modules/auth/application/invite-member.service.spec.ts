import * as sentry from '@/infra/observability/sentry-reporter';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { failingAccountAudit } from '@/modules/account-audit/testing/failing-account-audit';
import { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { InviteMemberService } from './invite-member.service';

function build(audit: AccountAuditRecorder = new FakeAccountAudit()) {
  const membership = { authUserId: 'user-1', isActive: true };
  const membershipService = {
    listForTenant: jest.fn().mockResolvedValue([membership]),
    update: jest.fn(),
  };
  const apiKeyService = { revokeCreatedBy: jest.fn() };
  const authUserService = {
    getUsersByIds: jest
      .fn()
      .mockResolvedValue(new Map([['user-1', { name: 'Maria Souza' }]])),
  };
  const service = new InviteMemberService(
    authUserService as never,
    membershipService as never,
    apiKeyService as never,
    audit,
  );
  return { service, membershipService, apiKeyService, authUserService, audit };
}

describe('InviteMemberService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('revokes the API keys a member created when the member is removed', async () => {
    const { service, membershipService, apiKeyService } = build();

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

  it('records member.removed with the member name', async () => {
    const { service, audit } = build();
    await service.removeMember('tenant-1', 'user-1');
    const events = (audit as FakeAccountAudit).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId: 'tenant-1',
      action: 'member.removed',
      target: { type: 'member', id: 'user-1', label: 'Maria Souza' },
    });
  });

  it('removes the member even when the name lookup fails', async () => {
    const { service, authUserService, audit } = build();
    authUserService.getUsersByIds.mockRejectedValue(new Error('db down'));
    await service.removeMember('tenant-1', 'user-1');
    expect((audit as FakeAccountAudit).events[0].target).toMatchObject({
      id: 'user-1',
      label: null,
    });
  });

  it('records nothing when the member does not exist', async () => {
    const { service, membershipService, audit } = build();
    membershipService.listForTenant.mockResolvedValue([]);
    await expect(service.removeMember('tenant-1', 'user-1')).rejects.toThrow();
    expect((audit as FakeAccountAudit).events).toHaveLength(0);
  });

  it('keeps the action when the recorder fails', async () => {
    jest.spyOn(sentry, 'captureRuntimeException').mockReturnValue(undefined);
    const { service, membershipService } = build(failingAccountAudit());
    await expect(
      service.removeMember('tenant-1', 'user-1'),
    ).resolves.toBeUndefined();
    expect(membershipService.update).toHaveBeenCalled();
  });
});
