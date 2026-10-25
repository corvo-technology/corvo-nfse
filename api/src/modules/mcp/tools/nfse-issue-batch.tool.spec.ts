import 'reflect-metadata';
import {
  createNfseIssueBatchHandler,
  NFSE_ISSUE_BATCH_TOOL,
} from './nfse-issue-batch.tool';
import type { InvoiceBatchService } from '@/modules/invoice/application/invoice-batch.service';
import type { AuthContext } from '@/modules/auth/auth-context';

const context = {
  tenantId: 'tenant-1',
  executionEnvironment: 'test',
} as AuthContext;
const row = (extra: Record<string, unknown> = {}) => ({
  company_tax_id: '11222333000181',
  amount: 100,
  competence_date: '2026-01-01',
  ...extra,
});

describe('nfse_issue_batch', () => {
  let emitBatch: jest.Mock;
  let handler: ReturnType<typeof createNfseIssueBatchHandler>;

  beforeEach(() => {
    emitBatch = jest.fn(async (items: unknown[]) => ({
      total: items.length,
      accepted: items.length,
      rejected: 0,
      results: items.map((_item, index) => ({
        index,
        status: 'accepted',
        invoice: {
          id: `inv-${index}`,
          accessKey: `key-${index}`,
          status: 'queued',
        },
      })),
    }));
    handler = createNfseIssueBatchHandler({
      emitBatch,
    } as unknown as InvoiceBatchService);
  });

  it('is described for spreadsheets, with the 50 limit and idempotency guidance', () => {
    expect(NFSE_ISSUE_BATCH_TOOL.name).toBe('nfse_issue_batch');
    expect(NFSE_ISSUE_BATCH_TOOL.description).toContain('50');
    expect(NFSE_ISSUE_BATCH_TOOL.description).toContain('idempotency_key');
    expect(NFSE_ISSUE_BATCH_TOOL.inputSchema.required).toContain('invoices');
  });

  it('maps snake_case items to the invoice dto and passes idempotency_key per item', async () => {
    await handler(
      {
        invoices: [
          row({
            idempotency_key: 'sheet-1-row-2',
            customer: { tax_id: '52998224725', name: 'Cliente' },
          }),
        ],
      },
      context,
    );
    expect(emitBatch).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          companyTaxId: '11222333000181',
          amount: 100,
          competenceDate: '2026-01-01',
          customer: expect.objectContaining({ taxId: '52998224725' }),
          idempotencyKey: 'sheet-1-row-2',
        }),
      ],
      'tenant-1',
      context,
    );
  });

  it('returns accepted items with invoice_id, access_key and invoice_status', async () => {
    const result = await handler({ invoices: [row()] }, context);
    expect(result).toEqual({
      total: 1,
      accepted: 1,
      rejected: 0,
      results: [
        {
          index: 0,
          status: 'accepted',
          invoice_id: 'inv-0',
          access_key: 'key-0',
          invoice_status: 'queued',
        },
      ],
    });
  });

  it('rejects an item with invalid input in place instead of throwing, keeping original indexes', async () => {
    const result = await handler(
      {
        invoices: [
          { amount: 'x' },
          row(),
          row({ customer: { name: 'sem documento' } }),
        ],
      },
      context,
    );
    expect(emitBatch.mock.calls[0][0]).toHaveLength(1);
    expect(result.results.map((r) => [r.index, r.status])).toEqual([
      [0, 'rejected'],
      [1, 'accepted'],
      [2, 'rejected'],
    ]);
    expect(result.results[0]?.error?.code).toBe('ERROR_VALIDATION');
    expect(result.results[2]?.error?.message).toContain('customer.tax_id');
    expect(result).toMatchObject({ total: 3, accepted: 1, rejected: 2 });
  });

  it('passes replayed through and maps service rejections back to original indexes', async () => {
    emitBatch.mockResolvedValue({
      total: 2,
      accepted: 1,
      rejected: 1,
      results: [
        {
          index: 0,
          status: 'accepted',
          replayed: true,
          invoice: { id: 'old', accessKey: null, status: 'authorized' },
        },
        {
          index: 1,
          status: 'rejected',
          error: {
            code: 'ERROR_COMPANY_NOT_FOUND',
            message: 'Company not found',
          },
        },
      ],
    });
    const result = await handler(
      { invoices: [{ bad: true }, row(), row()] },
      context,
    );
    expect(result.results[1]).toMatchObject({
      index: 1,
      status: 'accepted',
      replayed: true,
      invoice_id: 'old',
      access_key: '',
    });
    expect(result.results[2]).toEqual({
      index: 2,
      status: 'rejected',
      error: { code: 'ERROR_COMPANY_NOT_FOUND', message: 'Company not found' },
    });
  });

  it('does not call the service when every item is invalid', async () => {
    const result = await handler({ invoices: [{}, {}] }, context);
    expect(emitBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ total: 2, accepted: 0, rejected: 2 });
  });

  it.each([
    [{}],
    [{ invoices: [] }],
    [{ invoices: Array.from({ length: 51 }, () => row()) }],
  ])(
    'throws when invoices is missing, empty or over 50: %#',
    async (params) => {
      await expect(handler(params, context)).rejects.toThrow(/Invalid input/);
      expect(emitBatch).not.toHaveBeenCalled();
    },
  );
});
