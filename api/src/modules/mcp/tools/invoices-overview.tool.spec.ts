import 'reflect-metadata';
import { createInvoicesOverviewHandler } from './invoices-overview.tool';

const ctx = { activeTenantId: 'tenant-1', tenantId: 'tenant-1' } as never;

describe('invoices_overview tool', () => {
  it('reads the overview of the authenticated workspace', async () => {
    const get = jest.fn().mockResolvedValue({
      period: '30d',
      counts: { authorized: 3, rejected: 1, processing: 0 },
      dailyActivity: [],
      recentInvoices: [
        {
          toJSON: () => ({
            id: 'inv-1',
            status: 'authorized',
            tenantId: 'tenant-1',
            idempotencyKey: 'key',
            externalId: 'ext',
            emailSnapshot: { send: true },
            customerSnapshot: {
              name: 'Ana',
              taxId: '12345678901',
              email: 'ana@x.com',
            },
          }),
        },
      ],
    });
    const result = await createInvoicesOverviewHandler({ get })(
      { period: '30d' },
      ctx,
    );
    expect(get).toHaveBeenCalledWith('tenant-1', expect.anything(), '30d');
    expect(result).toMatchObject({
      counts: { authorized: 3 },
      recentInvoices: [
        { id: 'inv-1', customer_name: 'Ana', customer_tax_id: '***8901' },
      ],
    });
    const json = JSON.stringify(result);
    for (const forbidden of [
      'tenantId',
      'idempotencyKey',
      'externalId',
      'emailSnapshot',
      'ana@x.com',
      '12345678901',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('shows an NF-e and an NFC-e as a short line with its type', async () => {
    const get = jest.fn().mockResolvedValue({
      counts: { authorized: 2, rejected: 0, processing: 0 },
      dailyActivity: [],
      recentInvoices: [
        {
          id: 'nfe-1',
          type: 'nfe',
          companyId: 'co-1',
          environment: 'test',
          status: 'authorized',
          number: 7,
          accessKey: 'k'.repeat(44),
          amount: '150.00',
          recipientName: 'Loja X',
          externalId: 'ext-secret',
          authorizedAt: null,
          createdAt: new Date('2026-11-27T10:00:00Z'),
        },
      ],
    });
    const result = await createInvoicesOverviewHandler({ get })({}, ctx);
    expect(result.recentInvoices).toEqual([
      {
        type: 'nfe',
        id: 'nfe-1',
        company_id: 'co-1',
        status: 'authorized',
        number: 7,
        amount: '150.00',
        customer_name: 'Loja X',
        authorized_at: null,
        created_at: new Date('2026-11-27T10:00:00Z'),
      },
    ]);
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
