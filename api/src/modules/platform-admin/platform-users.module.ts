import { Module } from '@nestjs/common';
import { PlatformUsersController } from './http/platform-users.controller';
import { PlatformUsersReadRepository } from './infra/read/platform-users.read-repository';
import { PlatformAdminCoreModule } from './platform-admin-core.module';

@Module({
  imports: [PlatformAdminCoreModule],
  controllers: [PlatformUsersController],
  providers: [PlatformUsersReadRepository],
})
export class PlatformUsersModule {}
