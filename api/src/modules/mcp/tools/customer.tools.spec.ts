import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import {
  createCustomerDeleteHandler,
  createCustomerListHandler,
  createCustomerUpdateHandler,
} from './customer.tools';

const ctx = {
  tenantId: 'tenant-1',
  activeTenantId: 'tenant-1',
  executionEnvironment: 'live',
} as unknown as AuthContext;
const scope = { tenantId: 'tenant-1', environment: 'live' };
const saved = {
  taxId: '11222333000181',
  name: 'Acme Ltda',
  email: null,
  address: null,
  indIeDest: null,
  stateRegistration: null,
  lastUsedAt: new Date('2026-11-10T12:00:00Z'),
  createdAt: new Date('2026-11-01T12:00:00Z'),
  updatedAt: new Date('2026-11-10T12:00:00Z'),
};

describe('customer tools', () => {
  const directory = { list: jest.fn(), update: jest.fn(), remove: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it('customer_list searches in the connected environment and answers in snake_case', async () => {
    directory.list.mockResolvedValue({ items: [saved], total: 1 });
    await expect(
      createCustomerListHandler(directory)({ search: 'acme' }, ctx),
    ).resolves.toEqual({
      customers: [
        {
          tax_id: '11222333000181',
          name: 'Acme Ltda',
          email: null,
          address: null,
          ind_ie_dest: null,
          state_registration: null,
          last_used_at: '2026-11-10T12:00:00.000Z',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    expect(directory.list).toHaveBeenCalledWith(
      scope,
      { search: 'acme' },
      { limit: 20, offset: 0 },
    );
  });

  it('customer_list works without arguments and refuses a limit above 100', async () => {
    directory.list.mockResolvedValue({ items: [], total: 0 });
    await createCustomerListHandler(directory)(undefined, ctx);
    expect(directory.list).toHaveBeenCalledTimes(1);
    await expect(
      createCustomerListHandler(directory)({ limit: 500 }, ctx),
    ).rejects.toThrow(/Invalid input/);
  });

  it('customer_update sends the NF-e address and state registration', async () => {
    directory.update.mockResolvedValue(saved);
    await createCustomerUpdateHandler(directory)(
      {
        tax_id: '11222333000181',
        address: {
          street: ' Av. Paulista ',
          number: '1000',
          district: 'Bela Vista',
          zip: '01310100',
          city_code: '3550308',
          city: 'São Paulo',
          state: 'SP',
        },
        ind_ie_dest: 1,
        state_registration: ' 111222333444 ',
      },
      ctx,
    );
    expect(directory.update).toHaveBeenCalledWith(
      scope,
      '11222333000181',
      expect.objectContaining({
        address: {
          street: 'Av. Paulista',
          number: '1000',
          complement: null,
          district: 'Bela Vista',
          zip: '01310100',
          cityCode: '3550308',
          city: 'São Paulo',
          state: 'SP',
        },
        indIeDest: 1,
        stateRegistration: '111222333444',
      }),
    );
    await expect(
      createCustomerUpdateHandler(directory)(
        { tax_id: '11222333000181', address: { street: 'x' } },
        ctx,
      ),
    ).rejects.toThrow(/Invalid input/);
  });

  it('customer_update accepts a document with punctuation and changes only what was sent', async () => {
    directory.update.mockResolvedValue({ ...saved, name: 'Acme S.A.' });
    await expect(
      createCustomerUpdateHandler(directory)(
        { tax_id: '11.222.333/0001-81', name: ' Acme S.A. ' },
        ctx,
      ),
    ).resolves.toMatchObject({ tax_id: '11222333000181', name: 'Acme S.A.' });
    expect(directory.update).toHaveBeenCalledWith(scope, '11222333000181', {
      name: 'Acme S.A.',
      email: undefined,
    });
  });

  it('customer_update removes the email with null and needs something to change', async () => {
    directory.update.mockResolvedValue(saved);
    await createCustomerUpdateHandler(directory)(
      { tax_id: '11222333000181', email: null },
      ctx,
    );
    expect(directory.update).toHaveBeenCalledWith(scope, '11222333000181', {
      name: undefined,
      email: null,
    });
    await expect(
      createCustomerUpdateHandler(directory)({ tax_id: '11222333000181' }, ctx),
    ).rejects.toThrow(/send name, email/);
  });

  it('reports an unknown customer and an invalid document', async () => {
    directory.update.mockResolvedValue(null);
    directory.remove.mockResolvedValue(false);
    await expect(
      createCustomerUpdateHandler(directory)(
        { tax_id: '11222333000181', name: 'X' },
        ctx,
      ),
    ).rejects.toThrow('Customer not found');
    await expect(
      createCustomerDeleteHandler(directory)({ tax_id: '11222333000181' }, ctx),
    ).rejects.toThrow('Customer not found');
    await expect(
      createCustomerDeleteHandler(directory)({ tax_id: '123' }, ctx),
    ).rejects.toThrow(/not a valid CPF or CNPJ/);
    expect(directory.remove).toHaveBeenCalledTimes(1);
  });

  it('customer_delete forgets the customer', async () => {
    directory.remove.mockResolvedValue(true);
    await expect(
      createCustomerDeleteHandler(directory)({ tax_id: '529.982.247-25' }, ctx),
    ).resolves.toEqual({ tax_id: '52998224725', deleted: true });
    expect(directory.remove).toHaveBeenCalledWith(scope, '52998224725');
  });
});
