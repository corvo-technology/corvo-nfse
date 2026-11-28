import { ConflictException, NotFoundException } from '@nestjs/common';
import type {
  IProductFavoriteRepository,
  NewProductFavorite,
  ProductFavorite,
} from '../domain/product-favorite';
import {
  MAX_PRODUCTS_PER_COMPANY,
  ProductFavoritesService,
} from './product-favorites.service';

const product = (n: number): ProductFavorite => ({
  id: `id-${n}`,
  tenantId: 't',
  companyId: 'c',
  description: `Produto ${n}`,
  code: '',
  gtin: null,
  ncm: '61091000',
  cest: null,
  cfop: '5102',
  unit: 'UN',
  unitPrice: 10,
  csosn: null,
  origin: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

describe('ProductFavoritesService', () => {
  const input: NewProductFavorite = {
    description: 'Produto 1',
    code: '',
    gtin: null,
    ncm: '61091000',
    cest: null,
    cfop: '5102',
    unit: 'UN',
    unitPrice: 10,
    csosn: null,
    origin: null,
  };

  function build(existing: ProductFavorite[], removed = true) {
    const repo = {
      list: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockResolvedValue(product(99)),
      delete: jest.fn().mockResolvedValue(removed),
    } as unknown as jest.Mocked<IProductFavoriteRepository>;
    return { repo, service: new ProductFavoritesService(repo) };
  }

  it('saves a product for the company', async () => {
    const { repo, service } = build([]);
    await expect(service.save('c', 't', input)).resolves.toEqual(product(99));
    expect(repo.save).toHaveBeenCalledWith('c', 't', input);
  });

  it('refuses a new product past the limit but lets a saved one be updated', async () => {
    const full = Array.from({ length: MAX_PRODUCTS_PER_COMPANY }, (_, n) =>
      product(n),
    );
    const { repo, service } = build(full);
    await expect(
      service.save('c', 't', { ...input, description: 'Novo' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
    await service.save('c', 't', { ...input, description: 'PRODUTO 3' });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('answers 404 when the product is not found for this tenant', async () => {
    const { service } = build([], false);
    await expect(service.delete('x', 'c', 't')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes within tenant and company', async () => {
    const { repo, service } = build([]);
    await service.delete('x', 'c', 't');
    expect(repo.delete).toHaveBeenCalledWith('x', 'c', 't');
  });
});
