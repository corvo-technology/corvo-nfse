import { ITenantMembershipRepository } from '../domain/tenant-membership.repository';
import { TenantAccessDeniedError } from '../domain/errors';
import { SensitiveAuthAuditService } from './sensitive-auth-audit.service';
import { makeMembership } from './auth-test-fixtures';
import { ActiveTenantService } from './active-tenant.service';

describe('ActiveTenantService', () => {
  it('switches active tenant when membership is active and audits it', async () => {
    const membershipRepo: jest.Mocked<ITenantMembershipRepository> = {
      findById: jest.fn(),
      findByAuthUserAndTenant: jest.fn().mockResolvedValue(makeMembership()),
      findByAuthUserTenantAndProduct: jest
        .fn()
        .mockResolvedValue(makeMembership()),
      listActiveByAuthUser: jest.fn(),
      listActiveByAuthUserAndProduct: jest.fn(),
      listActiveWithEstablishmentByAuthUserAndProduct: jest.fn(),
      listActiveByTenant: jest.fn(),
      listPage: jest.fn(),
      listPage: jest.fn(),
      listByTenant: jest.fn(),
      listWithAuthEmail: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    const audit = {
      record: jest.fn(),
    } as unknown as jest.Mocked<SensitiveAuthAuditService>;
    const service = new ActiveTenantService(membershipRepo, audit);

    await service.switchTenant(
      { authUserId: 'auth-user-1' },
      'tenant-1',
      'greenbarber',
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.active_tenant_changed' }),
    );
  });

  it('rejects tenant switch without active membership', async () => {
    const membershipRepo: jest.Mocked<ITenantMembershipRepository> = {
      findById: jest.fn(),
      findByAuthUserAndTenant: jest.fn().mockResolvedValue(null),
      findByAuthUserTenantAndProduct: jest.fn().mockResolvedValue(null),
      listActiveByAuthUser: jest.fn(),
      listActiveByAuthUserAndProduct: jest.fn(),
      listActiveWithEstablishmentByAuthUserAndProduct: jest.fn(),
      listActiveByTenant: jest.fn(),
      listPage: jest.fn(),
      listPage: jest.fn(),
      listByTenant: jest.fn(),
      listWithAuthEmail: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    const audit = {
      record: jest.fn(),
    } as unknown as jest.Mocked<SensitiveAuthAuditService>;
    const service = new ActiveTenantService(membershipRepo, audit);

    await expect(
      service.switchTenant(
        { authUserId: 'auth-user-1' },
        'tenant-2',
        'greenbarber',
      ),
    ).rejects.toThrow(TenantAccessDeniedError);
  });
});
