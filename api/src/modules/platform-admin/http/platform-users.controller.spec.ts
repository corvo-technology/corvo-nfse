import 'reflect-metadata';
import { CursorPage } from '@/shared/http/pagination';
import { PlatformUsersController } from './platform-users.controller';
import type { PlatformUsersReadRepository } from '../infra/read/platform-users.read-repository';

describe('PlatformUsersController', () => {
  it('repassa busca, limite e cursor ao repositório', async () => {
    const page = new CursorPage([], {
      limit: 50,
      hasMore: false,
      nextCursor: null,
    });
    const list = jest.fn().mockResolvedValue(page);
    const controller = new PlatformUsersController({
      list,
    } as unknown as PlatformUsersReadRepository);
    await expect(
      controller.list({ search: 'ana', limit: 20, cursor: 'c' }),
    ).resolves.toBe(page);
    expect(list).toHaveBeenCalledWith({
      search: 'ana',
      limit: 20,
      cursor: 'c',
    });
  });
  it('é rota de admin da plataforma sob platform/users', () => {
    expect(Reflect.getMetadata('path', PlatformUsersController)).toBe(
      'platform/users',
    );
    expect(
      Reflect.getMetadata('__guards__', PlatformUsersController),
    ).toBeDefined();
  });
});
