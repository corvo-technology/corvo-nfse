import type { AuthContextService } from '../application/auth-context.service';
import type { AuthUserService } from '../application/auth-user.service';
import type { CookiePolicyService } from '../application/cookie-policy.service';
import type { CookieSessionService } from '../application/cookie-session.service';
import type { PlatformAdminPolicy } from '../application/platform-admin.policy';
import type { NfeAccessPolicy } from '@/modules/fiscal-core/application/nfe-access.policy';
import { SessionController } from './session.controller';

const expiresAt = new Date('2030-01-01T00:00:00Z');
const session = {
  id: 's1',
  authUserId: 'u1',
  activeTenantId: 't1',
  expiresAt,
};
const context = {
  isPlatformAdmin: false,
  contextType: 'tenant',
  availableTenants: [],
  permissions: [],
};

function build(isAdmin: boolean, nfe = false, nfce = false) {
  const sessions = {
    generateCsrfToken: jest.fn().mockReturnValue('csrf'),
    switchTenant: jest.fn().mockResolvedValue(session),
  };
  const contexts = { buildForAuthUser: jest.fn().mockResolvedValue(context) };
  const users = {
    findById: jest.fn().mockResolvedValue({ name: 'Ana', email: 'a@x.com' }),
  };
  const policy = {
    resolve: jest.fn().mockResolvedValue({ isAdmin, email: 'a@x.com' }),
  };
  const nfeAccess = {
    isEnabled: jest.fn(
      (_tenant: string, type: 'nfe' | 'nfce' = 'nfe') =>
        Promise.resolve(type === 'nfce' ? nfce : nfe),
    ),
  };
  const controller = new SessionController(
    sessions as unknown as CookieSessionService,
    contexts as unknown as AuthContextService,
    {} as unknown as CookiePolicyService,
    users as unknown as AuthUserService,
    policy as unknown as PlatformAdminPolicy,
    nfeAccess as unknown as NfeAccessPolicy,
  );
  return { controller, policy, nfeAccess };
}

const req = { authSession: session } as never;

describe('SessionController platform admin flag', () => {
  it('getSession devolve isPlatformAdmin true para admin, com context.isPlatformAdmin false e contextType tenant', async () => {
    const { controller, policy } = build(true);
    const res = await controller.getSession(req);
    expect(res.data.isPlatformAdmin).toBe(true);
    expect(res.data.context.isPlatformAdmin).toBe(false);
    expect(res.data.context.contextType).toBe('tenant');
    expect(policy.resolve).toHaveBeenCalledWith('u1');
  });

  it('getSession devolve false para quem não é admin', async () => {
    const { controller } = build(false);
    expect((await controller.getSession(req)).data.isPlatformAdmin).toBe(false);
  });

  it('switchTenant também devolve isPlatformAdmin', async () => {
    const { controller } = build(true);
    const res = await controller.switchTenant(req, { tenantId: 't1' });
    expect(res.data.isPlatformAdmin).toBe(true);
  });

  it('devolve features.nfe conforme a liberação do tenant ativo', async () => {
    const on = build(false, true);
    expect((await on.controller.getSession(req)).data.features).toEqual({
      nfe: true,
      nfce: false,
    });
    expect(on.nfeAccess.isEnabled).toHaveBeenCalledWith('t1');
    const off = build(false, false);
    expect((await off.controller.getSession(req)).data.features).toEqual({
      nfe: false,
      nfce: false,
    });
    const both = build(false, true, true);
    expect((await both.controller.getSession(req)).data.features).toEqual({
      nfe: true,
      nfce: true,
    });
    expect(both.nfeAccess.isEnabled).toHaveBeenCalledWith('t1', 'nfce');
    const switched = await on.controller.switchTenant(req, { tenantId: 't1' });
    expect(switched.data.features).toEqual({ nfe: true, nfce: false });
  });
});
