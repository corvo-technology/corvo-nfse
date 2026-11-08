import { AuthUserService } from './auth-user.service';

const user = {
  id: 'u1',
  email: 'pedrook16@gmail.com',
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
    const result = await service.updateName('u1', '  Pedro Henrique  ');
    expect(result.name).toBe('Pedro Henrique');
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'u1',
        email: user.email,
        name: 'Pedro Henrique',
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
