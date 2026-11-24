import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CnpjController } from './cnpj.controller';
import type { CnpjProfile } from '../domain/registry-check';

const profile: CnpjProfile = {
  legalName: 'EMPRESA EXEMPLO LTDA',
  tradeName: 'EXEMPLO',
  address: {
    zip: '01310100',
    street: 'RUA DAS FLORES',
    number: '123',
    complement: '',
    district: 'CENTRO',
    city: 'SAO PAULO',
    state: 'SP',
  },
  municipalityCode: '3550308',
  simples: true,
  mei: false,
  active: true,
  situation: 'ATIVA',
};

const make = (result: CnpjProfile | null) => {
  const lookupProfile = jest.fn().mockResolvedValue(result);
  const controller = new CnpjController({
    lookup: jest.fn(),
    lookupProfile,
  });
  return { controller, lookupProfile };
};

describe('CnpjController', () => {
  it('returns the profile for a valid CNPJ, with or without punctuation', async () => {
    const { controller, lookupProfile } = make(profile);
    await expect(controller.lookup('11.222.333/0001-81')).resolves.toEqual({
      data: profile,
    });
    expect(lookupProfile).toHaveBeenCalledWith('11222333000181');
  });

  it('rejects an invalid CNPJ without calling the registry', async () => {
    const { controller, lookupProfile } = make(profile);
    await expect(controller.lookup('11222333000182')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(lookupProfile).not.toHaveBeenCalled();
  });

  it('answers 404 when the registry has nothing', async () => {
    const { controller } = make(null);
    await expect(controller.lookup('11222333000181')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
