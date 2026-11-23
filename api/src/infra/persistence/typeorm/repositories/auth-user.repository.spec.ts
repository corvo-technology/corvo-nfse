import { TypeOrmAuthUserRepository } from './auth.repositories';

const user = {
  id: 'u1',
  email: 'maria@example.com',
  name: 'Maria',
  emailVerifiedAt: null,
  primaryIdentityType: null,
  lastLoginAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('TypeOrmAuthUserRepository save path', () => {
  it('never writes last_login_at from a saved user', async () => {
    const save = jest.fn(async (row: object) => ({ ...row }));
    const repo = new TypeOrmAuthUserRepository({
      repository: () => ({ save }),
    } as never);

    await repo.update(user);

    const row = save.mock.calls[0][0] as Record<string, unknown>;
    expect(row.lastLoginAt).toBeUndefined();
    expect(row.name).toBe('Maria');
  });
});
