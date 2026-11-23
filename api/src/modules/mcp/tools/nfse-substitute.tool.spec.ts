import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createNfseSubstituteHandler } from './nfse-substitute.tool';

const ctx = {
  tenantId: 'tenant-1',
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;
const invoiceId = '09947127-2702-4f6d-9da8-cb463608d812';

describe('nfse_substitute tool', () => {
  const substitute = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    substitute.mockResolvedValue({
      id: 'substitute-1',
      status: 'queued',
      substitutesInvoiceId: invoiceId,
    });
  });

  it('issues the substitute in the caller tenant and environment', async () => {
    await expect(
      createNfseSubstituteHandler({ substitute })(
        {
          invoice_id: invoiceId,
          description: 'Descrição do serviço corrigida',
          service_description: 'Consultoria, outubro/2026',
          notes: '',
        },
        ctx,
      ),
    ).resolves.toEqual({
      invoice_id: 'substitute-1',
      status: 'queued',
      substitutes_invoice_id: invoiceId,
    });
    expect(substitute).toHaveBeenCalledWith(invoiceId, 'tenant-1', 'test', {
      description: 'Descrição do serviço corrigida',
      service: { description: 'Consultoria, outubro/2026' },
      purchaseOrder: undefined,
      notes: '',
    });
  });

  it('refuses a short reason and an invalid id before issuing anything', async () => {
    const handler = createNfseSubstituteHandler({ substitute });
    await expect(
      handler({ invoice_id: invoiceId, description: 'curta' }, ctx),
    ).rejects.toThrow(/Invalid input: description/);
    await expect(
      handler(
        { invoice_id: 'abc', description: 'Descrição do serviço corrigida' },
        ctx,
      ),
    ).rejects.toThrow(/Invalid input: invoice_id/);
    expect(substitute).not.toHaveBeenCalled();
  });
});
