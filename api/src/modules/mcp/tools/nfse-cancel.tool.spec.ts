import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { CANCELLATION_DESCRIPTION_MAX } from '@/modules/invoice/domain/cancellation-reason';
import { NFSE_CANCEL_TOOL, createNfseCancelHandler } from './nfse-cancel.tool';

const ctx = {
  tenantId: 'tenant-1',
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;
const invoiceId = '09947127-2702-4f6d-9da8-cb463608d812';

describe('nfse_cancel tool', () => {
  it('delegates to InvoiceService.cancel in the caller tenant and environment', async () => {
    const cancel = jest.fn().mockResolvedValue({
      id: invoiceId,
      status: 'cancelling',
      cancelledAt: null,
    });
    const handler = createNfseCancelHandler({ cancel });
    await expect(
      handler(
        {
          invoice_id: invoiceId,
          reason: 'issue_error',
          description: 'Valor informado incorretamente',
        },
        ctx,
      ),
    ).resolves.toEqual({
      invoice_id: invoiceId,
      status: 'cancelling',
      cancelled_at: null,
    });
    expect(cancel).toHaveBeenCalledWith(invoiceId, 'tenant-1', 'test', {
      reason: 'issue_error',
      description: 'Valor informado incorretamente',
    });
  });

  it('describes cancelling an invoice that is still being issued', () => {
    expect(NFSE_CANCEL_TOOL.description).toContain('"processing"');
    expect(NFSE_CANCEL_TOOL.description).toContain('cancelled automatically');
    expect(NFSE_CANCEL_TOOL.description).toContain('credit is not refunded');
  });

  it('rejects an unknown reason before calling the service', async () => {
    const cancel = jest.fn();
    const handler = createNfseCancelHandler({ cancel });
    await expect(
      handler({ invoice_id: invoiceId, reason: 'because' }, ctx),
    ).rejects.toThrow('Invalid input: reason');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('advertises the shared description maxLength in the input schema', () => {
    expect(NFSE_CANCEL_TOOL.inputSchema.properties.description.maxLength).toBe(
      CANCELLATION_DESCRIPTION_MAX,
    );
  });
});
