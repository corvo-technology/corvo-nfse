import { Module } from '@nestjs/common';
import { PlatformAttentionController } from './http/platform-attention.controller';
import { PlatformAttentionReadRepository } from './infra/read/platform-attention.read-repository';
import { PlatformAdminCoreModule } from './platform-admin-core.module';

@Module({
  imports: [PlatformAdminCoreModule],
  controllers: [PlatformAttentionController],
  providers: [PlatformAttentionReadRepository],
})
export class PlatformAttentionModule {}
