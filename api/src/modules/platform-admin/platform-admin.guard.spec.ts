import { Logger, NotFoundException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

describe('PlatformAdminGuard', () => {
  const ctx = (request: Record<string, unknown>) =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;
  const member = {
    authUserId: 'user-1',
    principalType: 'tenant_member',
  };
  const make = (result: { isAdmin: boolean; email: string | null }) => {
    const config = {
      getOrThrow: jest
        .fn()
        .mockReturnValue({ hmacSecret: 'test-secret-aaaa' }),
    };
    const policy = { resolve: jest.fn().mockResolvedValue(result) };
    return {
      policy,
      guard: new PlatformAdminGuard(policy as never, config as never),
    };
  };
  const expectNotFound = async (p: Promise<unknown>) => {
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('404 RESOURCE_NOT_FOUND para sessão que não é admin', async () => {
    const { guard } = make({ isAdmin: false, email: 'a@b.co' });
    await expectNotFound(
      guard.canActivate(
        ctx({ authMode: 'cookie', authContext: member, headers: {} }),
      ),
    );
  });

  it('404 para principal api_key mesmo com o dono na lista', async () => {
    const { guard, policy } = make({ isAdmin: true, email: 'a@b.co' });
    await expectNotFound(
      guard.canActivate(
        ctx({
          authMode: 'api_key',
          authContext: { ...member, principalType: 'api_key' },
        }),
      ),
    );
    await expectNotFound(
      guard.canActivate(ctx({ authMode: 'api_key', authContext: member })),
    );
    expect(policy.resolve).not.toHaveBeenCalled();
  });

  it('404 quando o contexto traz mcpConnectionId', async () => {
    const { guard } = make({ isAdmin: true, email: 'a@b.co' });
    await expectNotFound(
      guard.canActivate(
        ctx({
          authMode: 'cookie',
          authContext: { ...member, mcpConnectionId: 'mcp-1' },
        }),
      ),
    );
  });

  it('404 sem authContext', async () => {
    const { guard } = make({ isAdmin: true, email: 'a@b.co' });
    await expectNotFound(guard.canActivate(ctx({ headers: {} })));
  });

  it('libera admin e preenche request.platformAdmin', async () => {
    const { guard } = make({ isAdmin: true, email: 'owner@corvo.tech' });
    const request: Record<string, unknown> = {
      authMode: 'cookie',
      authContext: member,
      headers: {},
      ip: '203.0.113.9',
    };
    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(request.platformAdmin).toEqual({
      authUserId: 'user-1',
      email: 'owner@corvo.tech',
      ipHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('pergunta à política a cada requisição (2 requests = 2 resolve)', async () => {
    const { guard, policy } = make({ isAdmin: true, email: 'a@b.co' });
    const req = () => ({
      authMode: 'cookie',
      authContext: member,
      headers: {},
    });
    await guard.canActivate(ctx(req()));
    await guard.canActivate(ctx(req()));
    expect(policy.resolve).toHaveBeenCalledTimes(2);
  });

  it('registra Logger.warn com o usuário e a rota ao recusar', async () => {
    const { guard } = make({ isAdmin: false, email: 'a@b.co' });
    await guard
      .canActivate(
        ctx({
          authMode: 'cookie',
          authContext: member,
          method: 'GET',
          path: '/v1/platform/overview',
        }),
      )
      .catch(() => undefined);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('user-1'),
    );
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('/v1/platform/overview'),
    );
  });

  it('registra Logger.warn com usuário e authMode ao recusar principal inelegível', async () => {
    const { guard } = make({ isAdmin: true, email: 'a@b.co' });
    await guard
      .canActivate(
        ctx({
          authMode: 'api_key',
          authContext: member,
          path: '/v1/platform/x',
        }),
      )
      .catch(() => undefined);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringMatching(/user-1.*api_key/),
    );
    await guard.canActivate(ctx({})).catch(() => undefined);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('anonymous'),
    );
  });
});
