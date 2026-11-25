import 'reflect-metadata';
import {
  missingMemberPermissionMessage,
  missingScopeMessage,
} from './mcp-client-policy';

type Handler = (params: unknown, ctx: unknown) => Promise<unknown>;

/** Builds a McpService (optionally "self-hosted") and returns the handlers it registered. */
function build(selfHosted: boolean, role = 'admin'): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  jest.isolateModules(() => {
    jest.doMock('@/shared/deployment-mode', () => ({
      ...jest.requireActual<object>('@/shared/deployment-mode'),
      IS_SELF_HOSTED: selfHosted,
    }));
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { McpServer } =
      require('./mcp.server') as typeof import('./mcp.server');
    const { McpService } =
      require('./mcp.service') as typeof import('./mcp.service');
    const { ITenantMembershipRepository } =
      require('../auth/domain/tenant-membership.repository') as typeof import('../auth/domain/tenant-membership.repository');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const spy = jest
      .spyOn(McpServer.prototype, 'registerTool')
      .mockImplementation((definition, handler) => {
        handlers.set(definition.name, handler);
      });
    const deps: unknown[] = Array.from(
      { length: McpService.length },
      () => ({}),
    );
    const injected = Reflect.getMetadata('self:paramtypes', McpService) as {
      index: number;
      param: unknown;
    }[];
    const slot = injected.find((p) => p.param === ITenantMembershipRepository)!;
    deps[slot.index] = {
      findByAuthUserAndTenant: () => Promise.resolve({ role, isActive: true }),
    };
    new (McpService as unknown as new (...args: unknown[]) => unknown)(...deps);
    spy.mockRestore();
  });
  jest.dontMock('@/shared/deployment-mode');
  return handlers;
}

const ctx = (scope: string) => ({
  scope,
  authUserId: 'user-1',
  activeTenantId: 'tenant-1',
});

describe('McpService billing tools', () => {
  it('registers credits_purchase and payment_status behind billing:purchase with billing.manage', async () => {
    const handlers = build(false, 'developer');
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining(['credits_purchase', 'payment_status']),
    );
    // An old connection (no optional scope) is told to reconnect.
    await expect(
      handlers.get('credits_purchase')!(
        { units: 5, method: 'pix' },
        ctx('nfse:read nfse:write'),
      ),
    ).rejects.toThrow(missingScopeMessage('billing:purchase'));
    // The scope is there but the member lost billing.manage: refused at call time.
    await expect(
      handlers.get('payment_status')!(
        { payment_id: '4a6f2f4e-0d3b-4a54-9a2a-0b9f3a1b2c3d' },
        ctx('nfse:read billing:purchase'),
      ),
    ).rejects.toThrow(missingMemberPermissionMessage('billing.manage'));
  });

  it('does not register them when self-hosted', () => {
    const handlers = build(true);
    expect(handlers.has('credits_purchase')).toBe(false);
    expect(handlers.has('payment_status')).toBe(false);
    expect(handlers.has('credits_balance')).toBe(true);
  });
});
