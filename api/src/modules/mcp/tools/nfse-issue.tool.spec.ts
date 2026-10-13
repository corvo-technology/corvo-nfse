import 'reflect-metadata';
import { createNfseIssueHandler } from './nfse-issue.tool';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import type { AuthContext } from '@/modules/auth/auth-context';

describe('MCP invoice fiscal defaults', () => {
  it('forwards omitted defaults and explicit overrides to the shared invoice service', async () => {
    const emit = jest
      .fn()
      .mockResolvedValue({ id: 'invoice-1', status: 'queued' });
    const handler = createNfseIssueHandler({
      emit,
    } as unknown as InvoiceService);
    const context = {
      tenantId: 'tenant-1',
      executionEnvironment: 'test',
    } as AuthContext;
    const input = {
      company_id: '09947127-2702-4f6d-9da8-cb463608d812',
      customer: { name: 'Cliente', tax_id: '52998224725' },
      services: [{ description: 'Serviço', quantity: 1, unit_price: 100 }],
      competence_date: '2026-01-01',
    };
    await handler(input, context);
    expect(emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        service: {
          code: undefined,
          municipalityCode: undefined,
          description: 'Serviço',
        },
      }),
      'tenant-1',
      context,
      undefined,
    );
    await handler(
      { ...input, service_code: '010201', municipality_code: '3170206' },
      context,
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        service: {
          code: '010201',
          municipalityCode: '3170206',
          description: 'Serviço',
        },
      }),
      'tenant-1',
      context,
      undefined,
    );
  });
});
