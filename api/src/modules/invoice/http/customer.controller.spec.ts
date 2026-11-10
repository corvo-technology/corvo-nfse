import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerController } from './customer.controller';
import { UpdateCustomerDto } from './customer.dto';

const TENANT = '01927de2-1234-7890-abcd-ef0123456789';
const request = (apiKeyEnvironment: 'test' | 'live' = 'live') =>
  ({ authContext: { activeTenantId: TENANT, apiKeyEnvironment } }) as never;
const saved = {
  taxId: '11222333000181',
  name: 'Acme Ltda',
  email: null,
  lastUsedAt: new Date('2026-11-10T12:00:00Z'),
  createdAt: new Date('2026-11-01T12:00:00Z'),
  updatedAt: new Date('2026-11-10T12:00:00Z'),
};

describe('CustomerController', () => {
  const directory = {
    list: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new CustomerController(directory as never);
  beforeEach(() => jest.clearAllMocks());

  it('lists in the workspace and environment of the caller, with a cursor to the next page', async () => {
    directory.list.mockResolvedValue({ items: [saved], total: 3 });
    const page = await controller.list(
      { limit: 1, search: 'acme' },
      request('test'),
    );
    expect(directory.list).toHaveBeenCalledWith(
      { tenantId: TENANT, environment: 'test' },
      { search: 'acme' },
      { limit: 1, offset: 0 },
    );
    expect(page.data).toEqual([
      expect.objectContaining({
        taxId: '11222333000181',
        name: 'Acme Ltda',
        lastUsedAt: '2026-11-10T12:00:00.000Z',
      }),
    ]);
    expect(page.pagination).toMatchObject({ hasMore: true, nextCursor: '1' });
  });

  it('finds a customer by a document with punctuation', async () => {
    directory.find.mockResolvedValue(saved);
    const result = await controller.get('11.222.333/0001-81', request());
    expect(directory.find).toHaveBeenCalledWith(
      { tenantId: TENANT, environment: 'live' },
      '11222333000181',
    );
    expect(result.data.name).toBe('Acme Ltda');
  });

  it('answers 404 for an unknown customer and for a document that is not a CPF or CNPJ', async () => {
    directory.find.mockResolvedValue(null);
    await expect(
      controller.get('11222333000181', request()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.get('123', request())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(directory.find).toHaveBeenCalledTimes(1);
  });

  it('updates only the fields sent and answers 404 when there is nothing to update', async () => {
    directory.update.mockResolvedValue({ ...saved, name: 'Acme S.A.' });
    const result = await controller.update(
      '11222333000181',
      { name: 'Acme S.A.' },
      request(),
    );
    expect(directory.update).toHaveBeenCalledWith(
      { tenantId: TENANT, environment: 'live' },
      '11222333000181',
      { name: 'Acme S.A.', email: undefined },
    );
    expect(result.data.name).toBe('Acme S.A.');
    directory.update.mockResolvedValue(null);
    await expect(
      controller.update('11222333000181', { name: 'X' }, request()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes a customer and answers 404 when it was not saved', async () => {
    directory.remove.mockResolvedValue(true);
    expect(await controller.remove('52998224725', request())).toEqual({
      data: null,
    });
    directory.remove.mockResolvedValue(false);
    await expect(
      controller.remove('52998224725', request()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UpdateCustomerDto', () => {
  const errorsOf = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdateCustomerDto, body))).map(
      (error) => error.property,
    );

  it('accepts a name, an email, or null to clear the email', async () => {
    expect(await errorsOf({ name: ' Acme ' })).toEqual([]);
    expect(await errorsOf({ email: 'a@acme.test' })).toEqual([]);
    expect(await errorsOf({ email: null })).toEqual([]);
  });

  it('rejects a blank or too long name and an invalid email', async () => {
    expect(await errorsOf({ name: '   ' })).toEqual(['name']);
    expect(await errorsOf({ name: 'x'.repeat(301) })).toEqual(['name']);
    expect(await errorsOf({ email: 'not-an-email' })).toEqual(['email']);
  });
});
