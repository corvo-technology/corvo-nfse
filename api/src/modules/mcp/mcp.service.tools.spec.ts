import 'reflect-metadata';
import { ITenantMembershipRepository } from '../auth/domain/tenant-membership.repository';
import {
  missingMemberPermissionMessage,
  missingScopeMessage,
} from './mcp-client-policy';
import { McpServer } from './mcp.server';
import { McpService } from './mcp.service';

describe('McpService tool registration', () => {
  it('registers every tool exactly once (no duplicate names)', () => {
    const names: string[] = [];
    const spy = jest
      .spyOn(McpServer.prototype, 'registerTool')
      .mockImplementation((definition) => {
        names.push(definition.name);
      });
    const deps = Array.from({ length: 40 }, () => ({}));
    new (McpService as unknown as new (...args: unknown[]) => McpService)(
      ...deps,
    );
    spy.mockRestore();

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'nfse_repeat',
        'nfse_email_resend',
        'nfse_review',
        'company_update',
        'accountant_package_send',
        'service_favorite_list',
        'service_favorite_create',
        'service_favorite_delete',
        'invoices_overview',
        'credits_balance',
        'nfse_get',
        'company_fiscal_status',
        'company_numbering_check',
        'cnpj_lookup',
        'nfe_validate',
        'nfe_repeat',
        'nfe_correct',
        'nfe_inutilize',
        'nfe_number_gaps',
        'nfe_settings_get',
        'nfe_settings_update',
        'nfe_readiness',
      ]),
    );
  });

  it('nfse_review needs nfse:write and the nfse.invoices.issue permission', async () => {
    const tools: Record<string, (p: unknown, c: unknown) => Promise<unknown>> =
      {};
    const spy = jest
      .spyOn(McpServer.prototype, 'registerTool')
      .mockImplementation((definition, handler) => {
        tools[definition.name] = handler;
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
    let role = 'billing';
    deps[slot.index] = {
      findByAuthUserAndTenant: () => Promise.resolve({ role, isActive: true }),
    };
    new (McpService as unknown as new (...args: unknown[]) => McpService)(
      ...deps,
    );
    spy.mockRestore();
    const call = (scope: string) =>
      tools['nfse_review'](
        { invoice_id: 'x', action: 'retry' },
        { scope, authUserId: 'u', activeTenantId: 't' },
      );

    await expect(call('nfse:read')).rejects.toThrow(
      missingScopeMessage('nfse:write'),
    );
    await expect(call('nfse:read nfse:write')).rejects.toThrow(
      missingMemberPermissionMessage('nfse.invoices.issue'),
    );
    role = 'admin';
    // Past the checks the handler runs and fails on the empty fake dependencies, not on permission.
    await expect(call('nfse:read nfse:write')).rejects.not.toThrow(
      /permission|scope/i,
    );
  });
});
