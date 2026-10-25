import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateInvoiceBatchDto,
  MAX_INVOICE_BATCH_SIZE,
} from './invoice-batch.dto';

const errorsFor = (body: unknown) =>
  validate(plainToInstance(CreateInvoiceBatchDto, body as object), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('CreateInvoiceBatchDto', () => {
  it('limits a batch to 50 items', () => {
    expect(MAX_INVOICE_BATCH_SIZE).toBe(50);
  });

  it('rejects an empty list', async () => {
    expect(await errorsFor({ invoices: [] })).not.toHaveLength(0);
  });

  it('rejects 51 items', async () => {
    const invoices = Array.from({ length: 51 }, () => ({}));
    expect(await errorsFor({ invoices })).not.toHaveLength(0);
  });

  it('accepts 50 items', async () => {
    const invoices = Array.from({ length: 50 }, () => ({}));
    expect(await errorsFor({ invoices })).toHaveLength(0);
  });

  it('rejects a body whose invoices is not a list', async () => {
    expect(await errorsFor({ invoices: 'x' })).not.toHaveLength(0);
    expect(await errorsFor({})).not.toHaveLength(0);
  });

  it('accepts an item that is invalid as an invoice: item errors never fail the request', async () => {
    expect(
      await errorsFor({ invoices: [{ amount: 'not a number' }, null, 'x'] }),
    ).toHaveLength(0);
  });
});
