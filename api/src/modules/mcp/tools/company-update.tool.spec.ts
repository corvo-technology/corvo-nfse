import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createCompanyUpdateHandler } from './company-update.tool';

const ctx = {
  activeTenantId: 'tenant-1',
  authUserId: 'user-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;
const companyId = '09947127-2702-4f6d-9da8-cb463608d812';

describe('company_update tool', () => {
  const update = jest.fn();
  beforeEach(() => {
    jest.resetAllMocks();
    update.mockResolvedValue({
      toSnapshot: () => ({
        id: companyId,
        legalName: 'Corvo',
        tradeName: 'Novo',
        taxId: '11222333000181',
        municipalityCode: '3550308',
        defaultServiceCode: '010101',
        addressCity: 'São Paulo',
      }),
    });
  });

  it('updates only the safe fields sent', async () => {
    await expect(
      createCompanyUpdateHandler({ update })(
        {
          company_id: companyId,
          trade_name: 'Novo',
          default_service_code: '010101',
          address: { city: 'São Paulo' },
          tax_id: '99999999999999',
          tax_regime: 'mei',
        },
        ctx,
      ),
    ).resolves.toMatchObject({
      id: companyId,
      trade_name: 'Novo',
      tax_id: '11222333000181',
    });
    expect(update).toHaveBeenCalledWith(
      companyId,
      {
        tradeName: 'Novo',
        defaultServiceCode: '010101',
        address: { city: 'São Paulo' },
      },
      'tenant-1',
      'test',
      'user-1',
    );
  });

  it('refuses an empty update and bad codes', async () => {
    const handler = createCompanyUpdateHandler({ update });
    await expect(
      handler({ company_id: companyId, tax_id: '1' }, ctx),
    ).rejects.toThrow(/at least one/);
    await expect(
      handler({ company_id: companyId, municipality_code: '12' }, ctx),
    ).rejects.toThrow(/municipality_code/);
    expect(update).not.toHaveBeenCalled();
  });

  it('propagates company not found', async () => {
    update.mockRejectedValue(new Error('Company not found'));
    await expect(
      createCompanyUpdateHandler({ update })(
        { company_id: companyId, trade_name: 'x' },
        ctx,
      ),
    ).rejects.toThrow('Company not found');
  });
});
