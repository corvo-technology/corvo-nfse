import { AuthUserService } from './auth-user.service';

const user = {
  id: 'u1',
  email: 'maria99@example.com',
  name: '',
  emailVerifiedAt: new Date(),
  primaryIdentityType: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function build(found: typeof user | null = user) {
  const repo = {
    findById: jest.fn().mockResolvedValue(found),
    update: jest.fn(async (value: typeof user) => value),
  };
  return { service: new AuthUserService(repo as never), repo };
}

describe('AuthUserService.updateName', () => {
  it('saves the trimmed name and nothing else', async () => {
    const { service, repo } = build();
    const result = await service.updateName('u1', '  Maria Souza  ');
    expect(result.name).toBe('Maria Souza');
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'u1',
        email: user.email,
        name: 'Maria Souza',
      }),
    );
  });

  it('fails for an unknown user', async () => {
    const { service, repo } = build(null);
    await expect(service.updateName('nope', 'Ana')).rejects.toThrow(
      'User not found',
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});
