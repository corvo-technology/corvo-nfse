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
        'company_update',
        'accountant_package_send',
        'service_favorite_list',
        'service_favorite_create',
        'service_favorite_delete',
        'invoices_overview',
        'credits_balance',
        'nfse_get',
        'company_fiscal_status',
        'cnpj_lookup',
      ]),
    );
  });
});
