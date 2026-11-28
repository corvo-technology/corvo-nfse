import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateServiceFavoriteDto } from './service-favorites.dto';

const fields = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateServiceFavoriteDto, body))).map(
    (e) => e.property,
  );

describe('CreateServiceFavoriteDto', () => {
  it('a service (default) needs label, description and service code', async () => {
    expect(await fields({})).toEqual(
      expect.arrayContaining(['label', 'description', 'serviceCode']),
    );
    expect(
      await fields({
        label: 'Mensalidade',
        description: 'Consultoria',
        serviceCode: '010101',
      }),
    ).toEqual([]);
  });

  it('a product needs description, NCM (8 digits) and unit price, not a label or service code', async () => {
    expect(
      await fields({
        kind: 'product',
        description: 'Camiseta',
        ncm: '61091000',
        unitPrice: 49.9,
      }),
    ).toEqual([]);
    expect(
      await fields({ kind: 'product', description: 'x', ncm: '123' }),
    ).toEqual(expect.arrayContaining(['ncm', 'unitPrice']));
    expect(
      await fields({
        kind: 'product',
        description: 'x',
        ncm: '61091000',
        unitPrice: 1,
        csosn: '500',
        cfop: '51',
      }),
    ).toEqual(expect.arrayContaining(['csosn', 'cfop']));
  });

  it('refuses an unknown kind', async () => {
    expect(await fields({ kind: 'other', description: 'x' })).toContain('kind');
  });
});
