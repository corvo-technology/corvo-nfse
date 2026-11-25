import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CnpjController } from './cnpj.controller';
import type { CnpjProfile, CnpjProfileResult } from '../domain/registry-check';

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

const make = (result: CnpjProfileResult) => {
  const lookupProfile = jest.fn().mockResolvedValue(result);
  const controller = new CnpjController({
    lookup: jest.fn(),
    lookupProfile,
  });
  return { controller, lookupProfile };
};

describe('CnpjController', () => {
  it('returns the profile for a valid CNPJ, with or without punctuation', async () => {
    const { controller, lookupProfile } = make({ status: 'found', profile });
    await expect(controller.lookup('11.222.333/0001-81')).resolves.toEqual({
      data: profile,
    });
    expect(lookupProfile).toHaveBeenCalledWith('11222333000181');
  });

  it('rejects an invalid CNPJ without calling the registry', async () => {
    const { controller, lookupProfile } = make({ status: 'found', profile });
    await expect(controller.lookup('11222333000182')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(lookupProfile).not.toHaveBeenCalled();
  });

  it('answers 404 CNPJ_NOT_FOUND when the registry does not know the CNPJ', async () => {
    const { controller } = make({ status: 'not_found' });
    const error = await controller
      .lookup('11222333000181')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'CNPJ_NOT_FOUND',
    });
  });

  it('answers 503 CNPJ_LOOKUP_UNAVAILABLE when the registry is down', async () => {
    const { controller } = make({ status: 'unavailable' });
    const error = await controller
      .lookup('11222333000181')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      code: 'CNPJ_LOOKUP_UNAVAILABLE',
    });
  });
});
