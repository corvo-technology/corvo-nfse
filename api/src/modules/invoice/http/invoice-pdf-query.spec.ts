import { validateDto } from '@/shared/http/validate-dto';
import { InvoicePdfQuery } from './invoice.dto';

describe('InvoicePdfQuery', () => {
  it('accepts no layout, 80mm and a4', async () => {
    await expect(validateDto(InvoicePdfQuery, {}, 'query')).resolves.toEqual(
      {},
    );
    for (const layout of ['80mm', 'a4'])
      await expect(
        validateDto(InvoicePdfQuery, { layout }, 'query'),
      ).resolves.toMatchObject({ layout });
  });

  it('refuses another paper with 400', async () => {
    await expect(
      validateDto(InvoicePdfQuery, { layout: 'letter' }, 'query'),
    ).rejects.toMatchObject({ status: 400 });
  });
});
