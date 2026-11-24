import 'reflect-metadata';
import { createInvoicesOverviewHandler } from './invoices-overview.tool';

const ctx = { activeTenantId: 'tenant-1', tenantId: 'tenant-1' } as never;

describe('invoices_overview tool', () => {
  it('reads the overview of the authenticated workspace', async () => {
    const get = jest.fn().mockResolvedValue({
      period: '30d',
      counts: { authorized: 3, rejected: 1, processing: 0 },
      dailyActivity: [],
      recentInvoices: [{ toJSON: () => ({ id: 'inv-1' }) }],
    });
    const result = await createInvoicesOverviewHandler({ get })(
      { period: '30d' },
      ctx,
    );
    expect(get).toHaveBeenCalledWith('tenant-1', expect.anything(), '30d');
    expect(result).toMatchObject({
      counts: { authorized: 3 },
      recentInvoices: [{ id: 'inv-1' }],
    });
  });

  it('defaults to 7 days and rejects an unknown period', async () => {
    const get = jest
      .fn()
      .mockResolvedValue({ counts: {}, dailyActivity: [], recentInvoices: [] });
    const handler = createInvoicesOverviewHandler({ get });
    await handler({}, ctx);
    expect(get).toHaveBeenCalledWith('tenant-1', expect.anything(), '7d');
    await expect(handler({ period: '90d' }, ctx)).rejects.toThrow(
      /Invalid input: period/,
    );
  });
});
