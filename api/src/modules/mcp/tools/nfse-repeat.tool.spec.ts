import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createNfseRepeatHandler } from './nfse-repeat.tool';

const ctx = {
  tenantId: 'tenant-1',
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;
const invoiceId = '09947127-2702-4f6d-9da8-cb463608d812';
const emit = jest.fn();
const firstDto = (): Record<string, unknown> =>
  (emit.mock.calls as unknown[][])[0][0] as Record<string, unknown>;

const source = {
  id: invoiceId,
  toSnapshot: () => ({
    companyId: 'company-1',
    customerSnapshot: {
      taxId: '11222333000181',
      name: 'Cliente',
      email: 'c@x.com',
    },
    serviceSnapshot: {
      code: '010101',
      municipalityCode: '3550308',
      description: 'Consultoria',
      notes: 'obs',
    },
    amount: 1500,
    discount: 10,
  }),
};

describe('nfse_repeat tool', () => {
  const findByIdAndTenantId = jest.fn();
  const findByAccessKeyAndTenantId = jest.fn();
  const handler = createNfseRepeatHandler(
    { emit },
    { findByIdAndTenantId, findByAccessKeyAndTenantId },
  );
  beforeEach(() => {
    jest.resetAllMocks();
    findByIdAndTenantId.mockResolvedValue(source);
    findByAccessKeyAndTenantId.mockResolvedValue(source);
    emit.mockResolvedValue({
      kind: 'invoice',
      invoice: { id: 'new-1', accessKey: 'key-1', status: 'queued' },
    });
  });

  it('copies the previous note and lets the overrides win', async () => {
    await expect(
      handler(
        { invoice_id: invoiceId, amount: 2000, competence_date: '2026-11-01' },
        ctx,
      ),
    ).resolves.toEqual({
      invoice_id: 'new-1',
      access_key: 'key-1',
      status: 'queued',
      copied_from_invoice_id: invoiceId,
    });
    expect(findByIdAndTenantId).toHaveBeenCalledWith(
      invoiceId,
      'tenant-1',
      'test',
    );
    const dto = firstDto();
    expect(dto).toMatchObject({
      companyId: 'company-1',
      amount: 2000,
      competenceDate: '2026-11-01',
      customer: { taxId: '11222333000181', name: 'Cliente' },
      service: {
        code: '010101',
        municipalityCode: '3550308',
        description: 'Consultoria',
      },
      notes: 'obs',
    });
    expect(dto.discount).toBeUndefined();
  });

  it('finds the note by access key and keeps the copied amount', async () => {
    await handler({ access_key: 'key-0', description: 'Outra' }, ctx);
    expect(findByAccessKeyAndTenantId).toHaveBeenCalledWith(
      'key-0',
      'tenant-1',
      'test',
    );
    expect(firstDto()).toMatchObject({
      amount: 1500,
      discount: 10,
      service: { description: 'Outra' },
    });
    expect(firstDto().competenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('fails when the note is not found in the caller tenant', async () => {
    findByIdAndTenantId.mockResolvedValue(null);
    await expect(handler({ invoice_id: invoiceId }, ctx)).rejects.toThrow(
      /not found/,
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('requires invoice_id or access_key', async () => {
    await expect(handler({}, ctx)).rejects.toThrow(/Invalid input/);
    expect(emit).not.toHaveBeenCalled();
  });
});
