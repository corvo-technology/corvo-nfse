import { ForbiddenException } from '@nestjs/common';
import type { RequestWithAuthContext } from '../auth/auth-context';
import { McpConsentController } from './mcp-consent.controller';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const TENANT = '11111111-1111-4111-8111-111111111111';

type ContextBody = {
  scopes: { name: string }[];
  optional_scopes: { name: string; description: string }[];
  tenants: { allowed_optional_scopes: string[] }[];
};

function setup(role: 'admin' | 'developer') {
  const createAuthorizationCode = jest.fn().mockResolvedValue('code-1');
  const memberships = {
    listActiveWithEstablishmentByAuthUserAndProduct: jest
      .fn()
      .mockResolvedValue([
        { tenantId: TENANT, establishmentName: 'Acme', role },
      ]),
    findByAuthUserAndTenant: jest
      .fn()
      .mockResolvedValue({ role, isActive: true }),
  };
  const clients = {
    findById: jest.fn().mockResolvedValue({
      id: 'corvo-mcp',
      name: 'Claude',
      isActive: true,
      redirectUris: [REDIRECT],
      scopes: ['nfse:read', 'nfse:write'],
    }),
  };
  const controller = new McpConsentController(
    memberships as never,
    clients as never,
    { createAuthorizationCode } as never,
  );
  const req = {
    authContext: {
      sessionId: 's',
      authUserId: 'user-1',
      principalType: 'user',
    },
  } as unknown as RequestWithAuthContext;
  const base = {
    client_id: 'corvo-mcp',
    redirect_uri: REDIRECT,
    state: 'st',
    code_challenge: 'cc',
    code_challenge_method: 'S256',
  };
  return { controller, req, base, createAuthorizationCode };
}

async function contextOf(role: 'admin' | 'developer'): Promise<ContextBody> {
  const { controller, req, base } = setup(role);
  const res = (await controller.context(base, req)) as unknown as {
    data: ContextBody;
  };
  return res.data;
}

describe('McpConsentController optional scopes', () => {
  it('offers the optional scopes unchecked even when the client registered only nfse:read nfse:write', async () => {
    const body = await contextOf('admin');
    expect(body.scopes.map((s) => s.name)).toEqual(['nfse:read', 'nfse:write']);
    expect(body.optional_scopes.map((s) => s.name)).toEqual([
      'nfse:certificates',
      'billing:purchase',
    ]);
    expect(body.tenants[0].allowed_optional_scopes).toEqual([
      'nfse:certificates',
      'billing:purchase',
    ]);
  });

  it('marks billing:purchase not allowed for a developer', async () => {
    const body = await contextOf('developer');
    expect(body.tenants[0].allowed_optional_scopes).toEqual([]);
  });

  it('grants only the base scopes by default', async () => {
    const { controller, req, base, createAuthorizationCode } = setup('admin');
    await controller.decide(
      {
        ...base,
        decision: 'allow',
        tenant_id: TENANT,
        scope: 'nfse:read nfse:write',
      },
      req,
    );
    expect(createAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'nfse:read nfse:write' }),
    );
  });

  it('grants an optional scope the user checked', async () => {
    const { controller, req, base, createAuthorizationCode } = setup('admin');
    await controller.decide(
      {
        ...base,
        decision: 'allow',
        tenant_id: TENANT,
        scope: 'nfse:read nfse:write nfse:certificates',
      },
      req,
    );
    expect(createAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'nfse:read nfse:write nfse:certificates',
      }),
    );
  });

  it('refuses an optional scope the role cannot grant with MCP_SCOPE_NOT_ALLOWED', async () => {
    const { controller, req, base } = setup('developer');
    const call = controller.decide(
      {
        ...base,
        decision: 'allow',
        tenant_id: TENANT,
        scope: 'nfse:read nfse:write billing:purchase',
      },
      req,
    );
    await expect(call).rejects.toBeInstanceOf(ForbiddenException);
    await expect(call).rejects.toMatchObject({
      response: { code: 'MCP_SCOPE_NOT_ALLOWED' },
    });
  });
});
