import { Controller, Get, Query } from '@nestjs/common';
import type { CursorPage } from '@/shared/http/pagination';
import type { PlatformUserRow } from '../platform-admin.contract';
import { PlatformAdminRoute } from '../platform-admin.guard';
import { PlatformUsersReadRepository } from '../infra/read/platform-users.read-repository';
import { PlatformUsersQuery } from './platform-users-query.dto';

@PlatformAdminRoute()
@Controller('platform/users')
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsersReadRepository) {}

  @Get()
  list(
    @Query() query: PlatformUsersQuery,
  ): Promise<CursorPage<PlatformUserRow>> {
    return this.users.list({
      search: query.search,
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}
