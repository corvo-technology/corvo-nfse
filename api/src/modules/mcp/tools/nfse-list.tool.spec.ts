import { INVOICE_STATUSES } from '@/modules/invoice/domain/invoice-status';
import { createNfseListHandler, NFSE_LIST_TOOL } from './nfse-list.tool';

describe('nfse_list tool', () => {
  it('documents every invoice status in the status filter', () => {
    const description =
      NFSE_LIST_TOOL.inputSchema.properties.status.description;
    for (const status of INVOICE_STATUSES)
      expect(description).toContain(status);
    expect(description).toContain('cancelling');
    expect(description).toContain('cancelled');
  });

  it('drops internal fields but keeps what the agent acts on', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [
        {
          toJSON: () => ({
            id: 'inv-1',
            status: 'rejected',
            tenantId: 't',
            idempotencyKey: 'k',
            emailSnapshot: { send: true },
            fiscalSchemaVersion: '1.01',
            secretInternal: 'x',
            lastErrorCode: 'E1',
            lastErrorMessage: 'bad',
            accessKey: 'AK',
            customerSnapshot: { name: 'Ana', email: 'a@x.com' },
          }),
        },
      ],
      pagination: { nextCursor: null },
    });
    const result = await createNfseListHandler({ list } as never)({}, {
      tenantId: 't',
      activeTenantId: 't',
    } as never);
    expect(result.invoices).toEqual([
      {
        id: 'inv-1',
        status: 'rejected',
        lastErrorCode: 'E1',
        lastErrorMessage: 'bad',
        accessKey: 'AK',
        customerSnapshot: { name: 'Ana', email: 'a@x.com' },
      },
    ]);
  });

  it('passes the origin filter to the list and rejects unknown origins', async () => {
    const list = jest
      .fn()
      .mockResolvedValue({ data: [], pagination: { nextCursor: null } });
    const ctx = { tenantId: 't', activeTenantId: 't' } as never;
    const handler = createNfseListHandler({ list } as never);
    await handler({ origin: 'integration' }, ctx);
    expect(list).toHaveBeenCalledWith(
      't',
      expect.objectContaining({ origin: 'integration' }),
      expect.anything(),
    );
    await expect(handler({ origin: 'nope' }, ctx)).rejects.toThrow(
      'Invalid input: origin',
    );
  });
});
