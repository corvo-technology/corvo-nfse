import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import {
  createServiceFavoriteCreateHandler,
  createServiceFavoriteDeleteHandler,
  createServiceFavoriteListHandler,
} from './service-favorite.tools';

const ctx = {
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;
const companyId = '09947127-2702-4f6d-9da8-cb463608d812';
const favoriteId = '19947127-2702-4f6d-9da8-cb463608d812';
const favorite = {
  id: favoriteId,
  tenantId: 'tenant-1',
  companyId,
  label: 'Mensalidade',
  description: 'Consultoria mensal',
  serviceCode: '010101',
  amountCents: 15000,
  municipalityCode: null,
  createdAt: new Date(),
};

describe('service favorite tools', () => {
  const findById = jest.fn();
  const list = jest.fn();
  const create = jest.fn();
  const del = jest.fn();
  beforeEach(() => {
    jest.resetAllMocks();
    findById.mockResolvedValue({ id: companyId });
    list.mockResolvedValue([favorite]);
    create.mockResolvedValue(favorite);
    del.mockResolvedValue(undefined);
  });

  it('lists the favorites of a company of the caller tenant', async () => {
    const result = await createServiceFavoriteListHandler(
      { list },
      { findById },
    )({ company_id: companyId }, ctx);
    expect(result.favorites[0]).toMatchObject({
      id: favoriteId,
      service_code: '010101',
      amount_cents: 15000,
    });
    expect(findById).toHaveBeenCalledWith(companyId, 'tenant-1', 'test');
    expect(list).toHaveBeenCalledWith(companyId, 'tenant-1');
  });

  it('creates a favorite', async () => {
    await createServiceFavoriteCreateHandler({ create }, { findById })(
      {
        company_id: companyId,
        label: ' Mensalidade ',
        description: 'Consultoria mensal',
        service_code: '010101',
        amount_cents: 15000,
      },
      ctx,
    );
    expect(create).toHaveBeenCalledWith(companyId, 'tenant-1', {
      label: 'Mensalidade',
      description: 'Consultoria mensal',
      serviceCode: '010101',
      amountCents: 15000,
      municipalityCode: null,
    });
  });

  it('refuses a bad service code', async () => {
    await expect(
      createServiceFavoriteCreateHandler({ create }, { findById })(
        {
          company_id: companyId,
          label: 'a',
          description: 'b',
          service_code: '12',
        },
        ctx,
      ),
    ).rejects.toThrow(/service_code/);
    expect(create).not.toHaveBeenCalled();
  });

  it('deletes a favorite and propagates not found', async () => {
    const handler = createServiceFavoriteDeleteHandler(
      { delete: del },
      { findById },
    );
    await expect(
      handler({ company_id: companyId, favorite_id: favoriteId }, ctx),
    ).resolves.toEqual({ favorite_id: favoriteId, deleted: true });
    expect(del).toHaveBeenCalledWith(favoriteId, companyId, 'tenant-1');
    del.mockRejectedValue(new Error('Service favorite not found'));
    await expect(
      handler({ company_id: companyId, favorite_id: favoriteId }, ctx),
    ).rejects.toThrow('not found');
  });

  it('does not touch favorites of a company outside the tenant', async () => {
    findById.mockRejectedValue(new Error('Company not found'));
    await expect(
      createServiceFavoriteListHandler({ list }, { findById })(
        { company_id: companyId },
        ctx,
      ),
    ).rejects.toThrow('Company not found');
    expect(list).not.toHaveBeenCalled();
  });
});
