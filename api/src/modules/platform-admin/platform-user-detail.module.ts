import { Module } from '@nestjs/common';
import { PlatformUserDetailService } from './application/platform-user-detail.service';
import { PlatformUserDetailController } from './http/platform-user-detail.controller';
import { PlatformUserDetailReadRepository } from './infra/read/platform-user-detail.read-repository';
import { PlatformAdminCoreModule } from './platform-admin-core.module';

@Module({
  imports: [PlatformAdminCoreModule],
  controllers: [PlatformUserDetailController],
  providers: [PlatformUserDetailReadRepository, PlatformUserDetailService],
})
export class PlatformUserDetailModule {}
