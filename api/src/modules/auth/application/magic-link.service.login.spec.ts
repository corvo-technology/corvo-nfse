import { MagicLinkService } from './magic-link.service';

const user = {
  id: 'u1',
  email: 'maria@example.com',
  name: 'Maria',
  emailVerifiedAt: null,
  primaryIdentityType: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function build() {
  const authUsers = {
    markEmailVerified: jest.fn().mockResolvedValue(user),
    markLogin: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    createSession: jest.fn().mockResolvedValue({
      sessionToken: 'tok',
      session: { id: 's1' },
    }),
    generateCsrfToken: jest.fn().mockReturnValue('csrf'),
  };
  const service = new MagicLinkService(
    {} as never,
    {} as never,
    authUsers as never,
    {} as never,
    sessions as never,
    {
      buildForAuthUser: jest.fn().mockResolvedValue({ activeTenantId: 't1' }),
    } as never,
    { getOrThrow: () => ({ refreshTokenTtlDays: 30 }) } as never,
    { ensureWorkspace: jest.fn().mockResolvedValue(undefined) } as never,
    { enqueueWelcome: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, authUsers };
}

describe('MagicLinkService.completeLogin last login', () => {
  it('records the login once', async () => {
    const { service, authUsers } = build();
    await service.completeLogin(user, false, 'google');
    expect(authUsers.markLogin).toHaveBeenCalledTimes(1);
    expect(authUsers.markLogin).toHaveBeenCalledWith(user.id);
  });

  it('a failure recording the login does not break the login', async () => {
    const { service, authUsers } = build();
    authUsers.markLogin.mockRejectedValue(new Error('db'));
    await expect(
      service.completeLogin(user, false, 'x'),
    ).resolves.toHaveProperty('sessionToken');
  });
});
