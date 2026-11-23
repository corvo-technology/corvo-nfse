import { Module } from '@nestjs/common';
import { PlatformAdminCoreModule } from './platform-admin-core.module';
import { PlatformOverviewController } from './http/platform-overview.controller';
import { PlatformOverviewReadRepository } from './infra/read/platform-overview.read-repository';

@Module({
  imports: [PlatformAdminCoreModule],
  controllers: [PlatformOverviewController],
  providers: [PlatformOverviewReadRepository],
})
export class PlatformOverviewModule {}
