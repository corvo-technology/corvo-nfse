import { Controller, Get } from '@nestjs/common';
import { PlatformAdminRoute } from '../platform-admin.guard';
import type { PlatformOverview } from '../platform-admin.contract';
import { PlatformOverviewReadRepository } from '../infra/read/platform-overview.read-repository';

@PlatformAdminRoute()
@Controller('platform/overview')
export class PlatformOverviewController {
  constructor(private readonly repository: PlatformOverviewReadRepository) {}

  @Get()
  async overview(): Promise<{ data: PlatformOverview }> {
    return { data: await this.repository.snapshot(new Date()) };
  }
}
