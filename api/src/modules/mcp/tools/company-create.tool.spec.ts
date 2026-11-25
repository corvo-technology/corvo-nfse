import 'reflect-metadata';
import { createCompanyCreateHandler } from './company-create.tool';

describe('company_create', () => {
  it('maps snake_case MCP input and never accepts a certificate', async () => {
    const create = jest.fn().mockResolvedValue({
      toSnapshot: () => ({
        id: 'company-1',
        legalName: 'Corvo Ltda',
        taxId: '11222333000181',
        status: 'pending_setup',
      }),
    });
    const handler = createCompanyCreateHandler({ create } as never);
    await expect(
      handler(
        {
          legal_name: 'Corvo Ltda',
          tax_id: '11.222.333/0001-81',
          tax_regime: 'simple_national',
          simples_rate: '6.54',
          municipality_code: '3550308',
        },
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          executionEnvironment: 'test',
        } as never,
      ),
    ).resolves.toMatchObject({
      id: 'company-1',
      tax_id: '11222333000181',
      message: expect.stringContaining('certificate_upload'),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        legalName: 'Corvo Ltda',
        taxId: '11.222.333/0001-81',
        taxRegime: 'Simples Nacional',
        simplesRate: '6.54',
      }),
      'tenant-1',
      'test',
      'user-1',
    );
  });
});
