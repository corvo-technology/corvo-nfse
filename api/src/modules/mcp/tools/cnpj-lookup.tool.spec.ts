import 'reflect-metadata';
import { createCnpjLookupHandler } from './cnpj-lookup.tool';

const ctx = { activeTenantId: 'tenant-1' } as never;
const VALID = '11222333000181';

describe('cnpj_lookup tool', () => {
  it('returns the registry profile of a valid CNPJ', async () => {
    const lookupProfile = jest
      .fn()
      .mockResolvedValue({ legalName: 'Corvo', mei: false, active: true });
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

  it('rejects an invalid CNPJ without calling the registry', async () => {
    const lookupProfile = jest.fn();
    await expect(
      createCnpjLookupHandler({ lookupProfile })({ cnpj: '123' }, ctx),
    ).rejects.toThrow('The CNPJ is not valid');
    expect(lookupProfile).not.toHaveBeenCalled();
  });

  it('fails when the registry has no answer', async () => {
    await expect(
      createCnpjLookupHandler({
        lookupProfile: jest.fn().mockResolvedValue(null),
      })({ cnpj: VALID }, ctx),
    ).rejects.toThrow(/no answer/);
  });
});
