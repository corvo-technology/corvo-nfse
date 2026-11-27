import { Module } from '@nestjs/common';
import { NfeModule } from '@/modules/nfe/nfe.module';
import { PlatformContingencyService } from './application/platform-contingency.service';
import { PlatformContingencyController } from './http/platform-contingency.controller';
import { PlatformAdminCoreModule } from './platform-admin-core.module';

@Module({
  imports: [PlatformAdminCoreModule, NfeModule],
  controllers: [PlatformContingencyController],
  providers: [PlatformContingencyService],
})
export class PlatformContingencyModule {}
