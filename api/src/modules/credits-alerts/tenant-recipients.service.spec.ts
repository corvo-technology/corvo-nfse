import { TenantRecipientsService } from './tenant-recipients.service';

function build() {
  const memberships = {
    listForTenant: jest.fn().mockResolvedValue([
      { authUserId: 'u-admin', role: 'admin', isActive: true },
      { authUserId: 'u-billing', role: 'billing', isActive: true },
      { authUserId: 'u-dev', role: 'developer', isActive: true },
      { authUserId: 'u-gone', role: 'admin', isActive: false },
      { authUserId: 'u-dup', role: 'billing', isActive: true },
    ]),
  };
  const emails: Record<string, string> = {
    'u-admin': 'Admin@Example.com',
    'u-billing': 'billing@example.com',
    'u-dev': 'dev@example.com',
    'u-gone': 'gone@example.com',
    'u-dup': 'ADMIN@example.com',
  };
  const users = {
    getUsersByIds: jest.fn((ids: string[]) => {
      const map = new Map<string, { email: string }>();
      for (const id of ids) map.set(id, { email: emails[id] });
      return Promise.resolve(map);
    }),
  };
  return {
    service: new TenantRecipientsService(memberships as never, users as never),
    memberships,
  };
}

describe('TenantRecipientsService.emailsFor', () => {
  it('returns the active admins and billing members, lower-cased and without duplicates', async () => {
    const { service } = build();
    expect(await service.emailsFor('tenant-1')).toEqual([
      'admin@example.com',
      'billing@example.com',
    ]);
  });

  it('returns nothing when the workspace has no such member', async () => {
    const { service, memberships } = build();
    memberships.listForTenant.mockResolvedValue([
      { authUserId: 'u-dev', role: 'developer', isActive: true },
    ]);
    expect(await service.emailsFor('tenant-1')).toEqual([]);
  });
});
