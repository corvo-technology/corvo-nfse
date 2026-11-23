import 'reflect-metadata';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import { PlatformCreditGrantController } from './platform-credit-grant.controller';

const TENANT = '11111111-1111-4111-8111-111111111111';
const actor = { authUserId: 'u', email: 'admin@corvo.tech', ipHash: null };

describe('PlatformCreditGrantController', () => {
  it('POST platform/tenants/:tenantId/credit-grants responde 200 e usa o guard do admin', () => {
    expect(Reflect.getMetadata('path', PlatformCreditGrantController)).toBe(
      'platform/tenants',
    );
    const handler = PlatformCreditGrantController.prototype.grant;
    expect(Reflect.getMetadata('path', handler)).toBe(
      ':tenantId/credit-grants',
    );
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(HttpStatus.OK);
    expect(
      Reflect.getMetadata('__guards__', PlatformCreditGrantController),
    ).toBeDefined();
  });

  it('repassa ator, tenant, corpo e chave ao serviço e envolve em { data }', async () => {
    const result = { tenantId: TENANT, amount: 5, balance: 5, replayed: false };
    const service = { grant: jest.fn().mockResolvedValue(result) };
    const controller = new PlatformCreditGrantController(service as never);

    const out = await controller.grant(
      { platformAdmin: actor },
      TENANT,
      'key-1',
      { amount: 5, reason: 'cortesia', notifyUser: true },
    );

    expect(out).toEqual({ data: result });
    expect(service.grant).toHaveBeenCalledWith(
      actor,
      TENANT,
      { amount: 5, reason: 'cortesia', notifyUser: true },
      'key-1',
    );
  });

  it('tenantId que não é UUID vira 404 RESOURCE_NOT_FOUND', () => {
    const params = Reflect.getMetadata(
      '__routeArguments__',
      PlatformCreditGrantController,
      'grant',
    ) as Record<string, { data?: string; pipes: unknown[] }>;
    const entry = Object.values(params).find((p) => p.data === 'tenantId')!;
    const pipe = entry.pipes[0] as {
      transform: (v: string, m: object) => Promise<string>;
    };
    return expect(
      pipe.transform('nao-uuid', { type: 'param', data: 'tenantId' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
