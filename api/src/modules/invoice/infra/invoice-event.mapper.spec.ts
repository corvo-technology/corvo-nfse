import { InvoiceEventMapper } from './invoice-event.mapper';
import { InvoiceEventOrmEntity } from './invoice-event.orm-entity';

describe('InvoiceEventMapper', () => {
  it('keeps the stored id and timestamp when reading an event', () => {
    const row = Object.assign(new InvoiceEventOrmEntity(), {
      id: '9034ce8e-0fc1-4482-86b8-1b5e6b697d45',
      invoiceId: '3affb6fa-bfc8-4a94-9a5c-b4a938d3611f',
      fromStatus: 'processing',
      toStatus: 'authorized',
      reason: 'NFS-e authorized',
      createdAt: new Date('2026-10-16T12:14:20.272Z'),
    });

    const event = new InvoiceEventMapper().toDomain(row);

    expect(event.toSnapshot()).toEqual({
      id: '9034ce8e-0fc1-4482-86b8-1b5e6b697d45',
      invoiceId: '3affb6fa-bfc8-4a94-9a5c-b4a938d3611f',
      fromStatus: 'processing',
      toStatus: 'authorized',
      reason: 'NFS-e authorized',
      createdAt: new Date('2026-10-16T12:14:20.272Z'),
    });
  });

  it('returns the same data on every read', () => {
    const row = Object.assign(new InvoiceEventOrmEntity(), {
      id: 'e1d2c3b4-5a6f-4b7c-8d9e-0f1a2b3c4d5e',
      invoiceId: '6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f',
      fromStatus: null,
      toStatus: 'queued',
      reason: null,
      createdAt: new Date('2026-10-10T12:00:00.000Z'),
    });
    const mapper = new InvoiceEventMapper();

    expect(mapper.toDomain(row).toSnapshot()).toEqual(
      mapper.toDomain(row).toSnapshot(),
    );
  });
});
