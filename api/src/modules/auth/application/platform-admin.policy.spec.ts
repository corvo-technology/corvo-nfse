import type { ConfigService } from '@nestjs/config';
import type { AuthUserService } from './auth-user.service';
import {
  PlatformAdminPolicy,
  parsePlatformAdminEmails,
} from './platform-admin.policy';

type FakeUser = { email: string; emailVerifiedAt: Date | null } | null;

function build(list: string | undefined, user: FakeUser) {
  const users = { findById: jest.fn().mockResolvedValue(user) };
  const config = { get: jest.fn().mockReturnValue(list) };
  const policy = new PlatformAdminPolicy(
    config as unknown as ConfigService,
    users as unknown as AuthUserService,
  );
  return { policy, users };
}

describe('PlatformAdminPolicy', () => {
  it('normaliza a lista', () =>
    expect([...parsePlatformAdminEmails(' Ana@X.com, b@y.com ,,')]).toEqual([
      'ana@x.com',
      'b@y.com',
    ]));

  it.each([undefined, '', '  '])('vazio %p = ninguém', (raw) =>
    expect(parsePlatformAdminEmails(raw).size).toBe(0),
  );

  it('admin: na lista e verificado, comparando em minúsculas', async () => {
    const { policy } = build('ana@x.com', {
      email: 'Ana@X.com',
      emailVerifiedAt: new Date(),
    });
    expect(await policy.resolve('u1')).toEqual({
      isAdmin: true,
      email: 'Ana@X.com',
    });
  });

  it('na lista mas e-mail não verificado não é admin', async () => {
    const { policy } = build('ana@x.com', {
      email: 'ana@x.com',
      emailVerifiedAt: null,
    });
    expect((await policy.resolve('u1')).isAdmin).toBe(false);
  });

  it('fora da lista, usuário inexistente e env vazio não são admin', async () => {
    const verified = { email: 'ana@x.com', emailVerifiedAt: new Date() };
    expect(
      (await build('outro@x.com', verified).policy.resolve('u1')).isAdmin,
    ).toBe(false);
    expect((await build('ana@x.com', null).policy.resolve('u1')).isAdmin).toBe(
      false,
    );
    expect(
      (await build(undefined, verified).policy.resolve('u1')).isAdmin,
    ).toBe(false);
  });

  it('lê o usuário a cada chamada (sem cache)', async () => {
    const { policy, users } = build('ana@x.com', {
      email: 'ana@x.com',
      emailVerifiedAt: new Date(),
    });
    await policy.resolve('u1');
    await policy.resolve('u1');
    expect(users.findById).toHaveBeenCalledTimes(2);
  });
});
