import { PLATFORM_ADMIN_ONLY } from '@/modules/auth/platform-admin-only.decorator';
import { PlatformOverviewController } from './platform-overview.controller';
import type { PlatformOverviewReadRepository } from '../infra/read/platform-overview.read-repository';

describe('PlatformOverviewController', () => {
  it('devolve { data: snapshot } e tem PLATFORM_ADMIN_ONLY', async () => {
    const snapshot = { users: { total: 1 } };
    const repo = {
      snapshot: jest.fn().mockResolvedValue(snapshot),
    } as unknown as PlatformOverviewReadRepository;
    const controller = new PlatformOverviewController(repo);
    await expect(controller.overview()).resolves.toEqual({ data: snapshot });
    expect(repo.snapshot).toHaveBeenCalledWith(expect.any(Date));
    expect(
      Reflect.getMetadata(PLATFORM_ADMIN_ONLY, PlatformOverviewController),
    ).toBe(true);
    expect(Reflect.getMetadata('path', PlatformOverviewController)).toBe(
      'platform/overview',
    );
  });
});
