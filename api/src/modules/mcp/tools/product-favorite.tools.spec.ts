import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import {
  createProductFavoriteCreateHandler,
  createProductFavoriteDeleteHandler,
  createProductFavoriteListHandler,
} from './product-favorite.tools';

const ctx = {
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;
const companyId = '09947127-2702-4f6d-9da8-cb463608d812';
const productId = '19947127-2702-4f6d-9da8-cb463608d812';
const saved = {
  id: productId,
  tenantId: 'tenant-1',
  companyId,
  description: 'Camiseta',
  code: 'CAM-1',
  gtin: null,
  ncm: '61091000',
  cest: null,
  cfop: '5102',
  unit: 'UN',
  unitPrice: 49.9,
  csosn: null,
  origin: null,
  createdAt: new Date(),
};

describe('product favorite MCP tools', () => {
  const companies = { findById: jest.fn().mockResolvedValue({}) };
  beforeEach(() => jest.clearAllMocks());

  it('lists the products of a company of the caller', async () => {
    const products = { list: jest.fn().mockResolvedValue([saved]) };
    const result = await createProductFavoriteListHandler(products, companies)(
      { company_id: companyId },
      ctx,
    );
    expect(companies.findById).toHaveBeenCalledWith(
      companyId,
      'tenant-1',
      'test',
    );
    expect(products.list).toHaveBeenCalledWith(companyId, 'tenant-1');
    expect(result.products[0]).toMatchObject({
      id: productId,
      unit_price: 49.9,
      ncm: '61091000',
    });
  });

  it('creates a product with defaults and trims the description', async () => {
    const products = { save: jest.fn().mockResolvedValue(saved) };
    await createProductFavoriteCreateHandler(products, companies)(
      {
        company_id: companyId,
        description: '  Camiseta ',
        ncm: '61091000',
        unit_price: 49.9,
      },
      ctx,
    );
    expect(products.save).toHaveBeenCalledWith(companyId, 'tenant-1', {
      description: 'Camiseta',
      code: '',
      gtin: null,
      ncm: '61091000',
      cest: null,
      cfop: null,
      unit: 'UN',
      unitPrice: 49.9,
      csosn: null,
      origin: null,
    });
  });

  it('refuses an NCM that is not 8 digits', async () => {
    const products = { save: jest.fn() };
    await expect(
      createProductFavoriteCreateHandler(products, companies)(
        {
          company_id: companyId,
          description: 'x',
          ncm: '123',
          unit_price: 1,
        },
        ctx,
      ),
    ).rejects.toThrow();
    expect(products.save).not.toHaveBeenCalled();
  });

  it('deletes a product', async () => {
    const products = { delete: jest.fn().mockResolvedValue(undefined) };
    await expect(
      createProductFavoriteDeleteHandler(products, companies)(
        { company_id: companyId, product_id: productId },
        ctx,
      ),
    ).resolves.toEqual({ product_id: productId, deleted: true });
    expect(products.delete).toHaveBeenCalledWith(
      productId,
      companyId,
      'tenant-1',
    );
  });
});
