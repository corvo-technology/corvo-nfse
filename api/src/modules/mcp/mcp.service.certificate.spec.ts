import 'reflect-metadata';
import type { AuthContext } from '../auth/auth-context';
import { missingScopeMessage } from './mcp-client-policy';
import { McpService } from './mcp.service';

function service(memberRole: string | null): McpService {
  const deps: unknown[] = Array.from(
    { length: McpService.length - 1 },
    () => ({}),
  );
  deps.push({
    findByAuthUserAndTenant: () =>
      Promise.resolve(memberRole ? { role: memberRole, isActive: true } : null),
  });
  return new (McpService as unknown as new (...args: unknown[]) => McpService)(
    ...deps,
  );
}

const call = (svc: McpService, scope: string) =>
  svc.getServer().handleRequest(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'certificate_upload',
        arguments: { tax_id: '1', pfx_base64: 'AAAA', password: 'x' },
      },
    },
    {
      scope,
      authUserId: 'user-1',
      activeTenantId: 'tenant-1',
      tenantId: 'tenant-1',
    } as AuthContext,
  );

describe('McpService certificate_upload', () => {
  it('registers certificate_upload behind nfse:certificates', async () => {
    const response = await call(service('admin'), 'nfse:read nfse:write');
    expect(response).toMatchObject({
      result: {
        isError: true,
        content: [
          { type: 'text', text: missingScopeMessage('nfse:certificates') },
        ],
      },
    });
  });

  it('refuses a member without nfse.certificates.manage at call time', async () => {
    const response = await call(
      service('developer'),
      'nfse:read nfse:write nfse:certificates',
    );
    expect(response).toMatchObject({ result: { isError: true } });
  });
});
