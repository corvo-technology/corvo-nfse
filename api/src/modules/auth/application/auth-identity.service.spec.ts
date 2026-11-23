import { AuthIdentityService } from './auth-identity.service';

function build() {
  const identities = {
    findByProviderAndEmail: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (value: unknown) => value),
  };
  const authUserService = {
    findByEmail: jest.fn().mockResolvedValue(null),
    createUser: jest.fn(async (input: { email: string; name: string }) => ({
      id: 'u1',
      ...input,
    })),
    setPrimaryIdentity: jest.fn(),
  };
  return {
    service: new AuthIdentityService(
      identities as never,
      authUserService as never,
    ),
    authUserService,
    identities,
  };
}

describe('AuthIdentityService.findOrCreateUserByMagicLink', () => {
  it('does not invent a name from the e-mail: the person is asked in onboarding', async () => {
    const { service, authUserService, identities } = build();
    const { isNew } = await service.findOrCreateUserByMagicLink(
      'maria99@example.com',
    );
    expect(isNew).toBe(true);
    expect(authUserService.createUser).toHaveBeenCalledWith({
      email: 'maria99@example.com',
      name: '',
    });
    expect(identities.save).toHaveBeenCalledTimes(1);
  });
});
