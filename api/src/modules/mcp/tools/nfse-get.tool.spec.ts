import 'reflect-metadata';
import { InvoiceNotFoundError } from '@/modules/invoice/domain/errors';
import { createNfseGetHandler } from './nfse-get.tool';

const ID = '4f6e2b0a-8a52-4d0e-9a3e-1c2b3d4e5f60';
const ctx = { activeTenantId: 'tenant-1', tenantId: 'tenant-1' } as never;

describe('nfse_get tool', () => {
  it('returns the invoice and its events timeline for the tenant', async () => {
    const findById = jest.fn().mockResolvedValue({
      toJSON: () => ({
        id: ID,
        status: 'authorized',
        tenantId: 'tenant-1',
        idempotencyKey: 'k',
        requestHash: 'h',
        documentKeyVersion: 1,
        fiscalSchemaVersion: '1.01',
        lastErrorProvider: 'sefin',
        emailSnapshot: { send: true },
        updatedAt: new Date(),
        secretInternal: 'x',
        accessKey: 'AK',
        nfseNumber: 7,
        dpsSeries: '1',
        dpsNumber: 9,
        customerSnapshot: { name: 'Ana', taxId: '123', email: 'a@x.com' },
      }),
    });
    const getEvents = jest
      .fn()
      .mockResolvedValue([
        { toJSON: () => ({ toStatus: 'queued' }) },
        { toJSON: () => ({ toStatus: 'authorized' }) },
      ]);
    const result = await createNfseGetHandler({ findById, getEvents })(
      { invoice_id: ID },
      ctx,
    );
    expect(findById).toHaveBeenCalledWith(ID, 'tenant-1', expect.anything());
    expect(getEvents).toHaveBeenCalledWith(ID, 'tenant-1', expect.anything());
    expect(result).toEqual({
      invoice: {
        id: ID,
        status: 'authorized',
        accessKey: 'AK',
        nfseNumber: 7,
        dpsSeries: '1',
        dpsNumber: 9,
        customerSnapshot: { name: 'Ana', taxId: '123', email: 'a@x.com' },
      },
      events: [{ toStatus: 'queued' }, { toStatus: 'authorized' }],
    });
    const json = JSON.stringify(result.invoice);
    for (const forbidden of [
      'tenantId',
      'idempotencyKey',
      'requestHash',
      'documentKeyVersion',
      'fiscalSchemaVersion',
      'lastErrorProvider',
      'emailSnapshot',
      'updatedAt',
      'secretInternal',
    ])
      expect(json).not.toContain(forbidden);
  });

  it('fails for an invoice of another tenant (not found)', async () => {
    const findById = jest.fn().mockRejectedValue(new InvoiceNotFoundError(ID));
    const getEvents = jest.fn();
    await expect(
      createNfseGetHandler({ findById, getEvents })({ invoice_id: ID }, ctx),
    ).rejects.toThrow(`Invoice not found: ${ID}`);
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a UUID', async () => {
    await expect(
      createNfseGetHandler({} as never)({ invoice_id: 'abc' }, ctx),
    ).rejects.toThrow(/Invalid input: invoice_id/);
  });
});
