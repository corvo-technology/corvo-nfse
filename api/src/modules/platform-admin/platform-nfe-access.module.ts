import { Module } from '@nestjs/common';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { PlatformNfeAccessService } from './application/platform-nfe-access.service';
import { PlatformNfeAccessRepository } from './infra/platform-nfe-access.repository';
import { PlatformNfeAccessController } from './http/platform-nfe-access.controller';
import { PlatformAdminCoreModule } from './platform-admin-core.module';

@Module({
  imports: [PlatformAdminCoreModule, AppRedisModule],
  controllers: [PlatformNfeAccessController],
  providers: [PlatformNfeAccessService, PlatformNfeAccessRepository],
})
export class PlatformNfeAccessModule {}
