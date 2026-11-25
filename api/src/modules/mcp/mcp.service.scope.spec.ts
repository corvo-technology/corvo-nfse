import 'reflect-metadata';
import type { AuthContext } from '../auth/auth-context';
import type { TenantMembership } from '../auth/domain/tenant-membership';
import {
  missingMemberPermissionMessage,
  missingScopeMessage,
} from './mcp-client-policy';
import { McpServer } from './mcp.server';
import { McpService } from './mcp.service';

type Wrapper = (
  handler: (p: unknown, c: AuthContext) => Promise<unknown>,
  scope: string,
  permission?: 'billing.manage' | 'nfse.certificates.manage',
) => (p: unknown, c: AuthContext) => Promise<unknown>;

function wrapperWith(membership: Partial<TenantMembership> | null): Wrapper {
  const spy = jest
    .spyOn(McpServer.prototype, 'registerTool')
    .mockImplementation();
  const deps: unknown[] = Array.from(
    { length: McpService.length - 1 },
    () => ({}),
  );
  deps.push({ findByAuthUserAndTenant: () => Promise.resolve(membership) });
  const service = new (
    McpService as unknown as new (...args: unknown[]) => McpService
  )(...deps);
  spy.mockRestore();
  const exposed = service as unknown as { wrapWithScopeCheck: Wrapper };
  return (handler, scope, permission) =>
    exposed.wrapWithScopeCheck(handler, scope, permission);
}

const ctx = (scope: string) =>
  ({ scope, authUserId: 'user-1', activeTenantId: 'tenant-1' }) as AuthContext;
const ok = () => Promise.resolve('done');

describe('McpService.wrapWithScopeCheck', () => {
  it('tells an old connection to reconnect and check the option', async () => {
    const wrap = wrapperWith(null);
    const call = wrap(ok, 'nfse:certificates')({}, ctx('nfse:read nfse:write'));
    await expect(call).rejects.toThrow(
      missingScopeMessage('nfse:certificates'),
    );
    await expect(call).rejects.not.toThrow(/Forbidden/);
  });

  it('keeps old connections working for the base scopes', async () => {
    const wrap = wrapperWith(null);
    await expect(
      wrap(ok, 'nfse:read')({}, ctx('nfse:read nfse:write')),
    ).resolves.toBe('done');
  });

  it('lets a member with the permission through', async () => {
    const wrap = wrapperWith({ role: 'admin', isActive: true });
    await expect(
      wrap(
        ok,
        'billing:purchase',
        'billing.manage',
      )({}, ctx('nfse:read billing:purchase')),
    ).resolves.toBe('done');
  });

  it('refuses at call time when the member lost the permission', async () => {
    const wrap = wrapperWith({ role: 'developer', isActive: true });
    await expect(
      wrap(
        ok,
        'billing:purchase',
        'billing.manage',
      )({}, ctx('nfse:read billing:purchase')),
    ).rejects.toThrow(missingMemberPermissionMessage('billing.manage'));
  });

  it('refuses an inactive membership', async () => {
    const wrap = wrapperWith({ role: 'admin', isActive: false });
    await expect(
      wrap(
        ok,
        'nfse:certificates',
        'nfse.certificates.manage',
      )({}, ctx('nfse:certificates')),
    ).rejects.toThrow(
      missingMemberPermissionMessage('nfse.certificates.manage'),
    );
  });
});
