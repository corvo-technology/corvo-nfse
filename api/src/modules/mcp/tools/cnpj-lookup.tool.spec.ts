import 'reflect-metadata';
import { createCnpjLookupHandler } from './cnpj-lookup.tool';

const ctx = { activeTenantId: 'tenant-1' } as never;
const VALID = '11222333000181';

describe('cnpj_lookup tool', () => {
  it('returns the registry profile of a valid CNPJ', async () => {
    const lookupProfile = jest.fn().mockResolvedValue({
      status: 'found',
      profile: { legalName: 'Corvo', mei: false, active: true },
    });
    await expect(
      createCnpjLookupHandler({ lookupProfile })(
        { cnpj: '11.222.333/0001-81' },
        ctx,
      ),
    ).resolves.toEqual({
      profile: { legalName: 'Corvo', mei: false, active: true },
    });
    expect(lookupProfile).toHaveBeenCalledWith(VALID);
  });

  it('returns the service code suggested by the activity next to the profile', async () => {
    const lookupProfile = jest.fn().mockResolvedValue({
      status: 'found',
      profile: {
        legalName: 'Corvo',
        cnae: { code: '9602501', description: 'Cabeleireiros' },
        suggestedServiceCode: { code: '060101', description: 'Barbearia' },
      },
    });
    await expect(
      createCnpjLookupHandler({ lookupProfile })({ cnpj: VALID }, ctx),
    ).resolves.toEqual({
      profile: {
        legalName: 'Corvo',
        cnae: { code: '9602501', description: 'Cabeleireiros' },
      },
      suggested_service_code: { code: '060101', description: 'Barbearia' },
    });
  });

  it('rejects an invalid CNPJ without calling the registry', async () => {
    const lookupProfile = jest.fn();
    await expect(
      createCnpjLookupHandler({ lookupProfile })({ cnpj: '123' }, ctx),
    ).rejects.toThrow('The CNPJ is not valid');
    expect(lookupProfile).not.toHaveBeenCalled();
  });

  it('tells an unknown CNPJ apart from a registry that is down', async () => {
    await expect(
      createCnpjLookupHandler({
        lookupProfile: jest.fn().mockResolvedValue({ status: 'not_found' }),
      })({ cnpj: VALID }, ctx),
    ).rejects.toThrow(/CNPJ_NOT_FOUND/);
    await expect(
      createCnpjLookupHandler({
        lookupProfile: jest.fn().mockResolvedValue({ status: 'unavailable' }),
      })({ cnpj: VALID }, ctx),
    ).rejects.toThrow(/CNPJ_LOOKUP_UNAVAILABLE/);
  });
});
