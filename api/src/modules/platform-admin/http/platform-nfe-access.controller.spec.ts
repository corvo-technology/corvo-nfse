import 'reflect-metadata';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import { PLATFORM_ADMIN_ONLY } from '@/modules/auth/platform-admin-only.decorator';
import { PlatformAdminGuard } from '../platform-admin.guard';
import { PlatformNfeAccessController } from './platform-nfe-access.controller';

const TENANT = '11111111-1111-4111-8111-111111111111';
const actor = { authUserId: 'u', email: 'admin@corvo.tech', ipHash: null };

describe('PlatformNfeAccessController', () => {
  it('PUT platform/tenants/:tenantId/nfe-access responde 200 atrás do guard do admin', () => {
    expect(Reflect.getMetadata('path', PlatformNfeAccessController)).toBe(
      'platform/tenants',
    );
    const handler = PlatformNfeAccessController.prototype.set;
    expect(Reflect.getMetadata('path', handler)).toBe(':tenantId/nfe-access');
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(HttpStatus.OK);
    expect(
      Reflect.getMetadata('__guards__', PlatformNfeAccessController),
    ).toContain(PlatformAdminGuard);
    expect(
      Reflect.getMetadata(PLATFORM_ADMIN_ONLY, PlatformNfeAccessController),
    ).toBe(true);
  });

  it('repassa ator, tenant e corpo ao serviço e envolve em { data }', async () => {
    const result = { tenantId: TENANT, enabled: true, enabledAt: '2026-11-26' };
    const service = { set: jest.fn().mockResolvedValue(result) };
    const controller = new PlatformNfeAccessController(service as never);

    const out = await controller.set({ platformAdmin: actor }, TENANT, {
      enabled: true,
      reason: 'liberar teste',
    });

    expect(out).toEqual({ data: result });
    expect(service.set).toHaveBeenCalledWith(actor, TENANT, {
      enabled: true,
      reason: 'liberar teste',
    });
  });

  it('tenantId que não é UUID vira 404 RESOURCE_NOT_FOUND', () => {
    const params = Reflect.getMetadata(
      '__routeArguments__',
      PlatformNfeAccessController,
      'set',
    ) as Record<string, { data?: string; pipes: unknown[] }>;
    const entry = Object.values(params).find((p) => p.data === 'tenantId')!;
    const pipe = entry.pipes[0] as {
      transform: (v: string, m: object) => Promise<string>;
    };
    return expect(
      pipe.transform('nao-uuid', { type: 'param', data: 'tenantId' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PUT platform/tenants/:tenantId/nfce-access liga a NFC-e pelo mesmo serviço', async () => {
    const handler = PlatformNfeAccessController.prototype.setNfce;
    expect(Reflect.getMetadata('path', handler)).toBe(':tenantId/nfce-access');
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(HttpStatus.OK);
    const result = { tenantId: TENANT, enabled: true, enabledAt: '2026-11-26' };
    const service = { set: jest.fn().mockResolvedValue(result) };
    const controller = new PlatformNfeAccessController(service as never);

    const out = await controller.setNfce({ platformAdmin: actor }, TENANT, {
      enabled: true,
      reason: 'liberar teste',
    });

    expect(out).toEqual({ data: result });
    expect(service.set).toHaveBeenCalledWith(actor, TENANT, {
      enabled: true,
      reason: 'liberar teste',
      type: 'nfce',
    });
  });
});
