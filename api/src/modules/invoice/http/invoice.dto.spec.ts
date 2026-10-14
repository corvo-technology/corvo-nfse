import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InvoiceOptionsDto } from './invoice.dto';

describe('InvoiceOptionsDto emission type', () => {
  it.each(['IMMEDIATE', 'SCHEDULE', undefined])('accepts %s', async (type) => {
    expect(
      await validate(plainToInstance(InvoiceOptionsDto, { type })),
    ).toEqual([]);
  });
  it.each(['LATER', 1])('rejects %s', async (type) => {
    const errors = await validate(plainToInstance(InvoiceOptionsDto, { type }));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'type',
          constraints: expect.objectContaining({ isIn: expect.any(String) }),
        }),
      ]),
    );
  });
});
