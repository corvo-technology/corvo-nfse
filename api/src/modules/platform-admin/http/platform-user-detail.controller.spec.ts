import { NotFoundException } from '@nestjs/common';
import { PLATFORM_ADMIN_ONLY } from '@/modules/auth/platform-admin-only.decorator';
import type { PlatformAdminActor } from '../platform-admin.guard';
import type { PlatformUserDetail } from '../platform-admin.contract';
import {
  ParsePlatformUserIdPipe,
  PlatformUserDetailController,
} from './platform-user-detail.controller';

const actor: PlatformAdminActor = {
  authUserId: '00000000-0000-4000-8000-0000000000a1',
  email: 'owner@corvo.tech',
  ipHash: null,
};

describe('PlatformUserDetailController', () => {
  it('devolve { data } do service usando o ator da requisição', async () => {
    const detail = { user: { id: 'x' } } as PlatformUserDetail;
    const service = { view: jest.fn().mockResolvedValue(detail) };
    const controller = new PlatformUserDetailController(service as never);
    const id = '00000000-0000-4000-8000-0000000000b2';
    await expect(controller.get({ platformAdmin: actor }, id)).resolves.toEqual(
      { data: detail },
    );
    expect(service.view).toHaveBeenCalledWith(actor, id);
  });

  it('id que não é UUID responde 404 RESOURCE_NOT_FOUND', async () => {
    const error = await ParsePlatformUserIdPipe.transform('not-a-uuid', {
      type: 'param',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('a classe é marcada como PLATFORM_ADMIN_ONLY', () => {
    expect(
      Reflect.getMetadata(PLATFORM_ADMIN_ONLY, PlatformUserDetailController),
    ).toBe(true);
  });

  it('sem ator na requisição responde 404 RESOURCE_NOT_FOUND', async () => {
    const controller = new PlatformUserDetailController({} as never);
    await expect(
      controller.get({}, '00000000-0000-4000-8000-0000000000b2'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });
});
